import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../database/database.service';
import { PagamentosService } from './pagamentos.service';
import { ProvedorCartao, ehProvedorCartao } from './provedor-pagamento';
import { ProvedoresService } from './provedores.service';
import { WebhooksProcessor } from './webhooks.processor';

/**
 * A cada 30 s, por tenant com provedor: processa webhooks pendentes e consulta
 * no provedor os pagamentos ainda 'pendente' (mais antigos primeiro, 50 por vez).
 * Cobre webhook perdido e expira o que venceu. PAGAMENTOS_DESLIGADO=true desliga.
 */
@Injectable()
export class PagamentosWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PagamentosWorker');
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly provedores: ProvedoresService,
    private readonly pagamentos: PagamentosService,
    private readonly webhooks: WebhooksProcessor,
  ) {}

  onModuleInit() {
    if (process.env.PAGAMENTOS_DESLIGADO === 'true') return;
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      for (const slug of await this.db.listActiveTenantSlugs()) {
        try {
          const provedores = await this.provedores.obterTodos(slug);
          if (!provedores.length) continue;
          const pool = await this.db.getTenantPool(slug);
          for (const pt of provedores) {
            await this.webhooks.processar(pool, pt.provedor);
            const { rows } = await pool.query(
              `select id, provedor_ref, expira_em, metodo, captura from pagamentos
                where status = 'pendente' and provedor = $1 order by criado_em limit 50`,
              [pt.provedor.nome],
            );
            for (const p of rows) {
              const ini = Date.now();
              try {
                const s = await pt.provedor.consultar(p.provedor_ref);
                await this.pagamentos.aplicarSituacao(pool, p, s);
                if (s.status !== 'pendente') {
                  await pool.query(
                    `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
                     values ($4,'fluxo_para_erp',$1,$2,true,$3)`,
                    [p.provedor_ref, s.status, Date.now() - ini, `${pt.provedor.nome}_consulta`],
                  );
                }
              } catch (e) {
                this.log.warn(`consulta ${slug}/${p.provedor_ref}: ${e}`);
                await pool.query(
                  `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
                   values ($4,'fluxo_para_erp',$1,$2,false,$3)`,
                  [p.provedor_ref, String(e).slice(0, 500), Date.now() - ini, `${pt.provedor.nome}_consulta`],
                );
              }
            }
            if (ehProvedorCartao(pt.provedor)) {
              await this.reservas(slug, pool, pt.provedor);
              await this.estornos(slug, pool, pt.provedor);
            }
            else await this.creditosPix(slug, pool, pt.provedor.nome);
          }
        } catch (e) {
          // Credencial quebrada ou banco fora do ar de UM tenant não pode parar os outros.
          this.log.error(`tenant ${slug}: ${e}`);
          continue;
        }
      }
    } catch (e) {
      this.log.error(e);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Pré-autorização ('autorizado' = valor só reservado no cartão):
   *  - pedido CANCELADO → libera a reserva (nada vai pra fatura);
   *  - NF-e chegou (FATURADO com valores) → cobra o valor da nota;
   *  - FATURADO sem valores há 6 h → cobra o reservado (o ERP não mandou o total);
   *  - reserva perto de vencer (prazo − folga) sem nota → cobra o reservado: entregar
   *    sem receber é pior que estornar diferença depois.
   * Falha da Rede espera 10 min antes de tentar de novo (captura_erro + atualizado_em).
   */
  private async reservas(slug: string, pool: Pool, provedor: ProvedorCartao) {
    // Reservas feitas com a chave ligada continuam valendo se ela for desligada depois.
    const pa = provedor.preAutorizacao ?? { prazoHoras: 72, folgaHoras: 12 };
    const limiteHoras = pa.prazoHoras - pa.folgaHoras;
    const { rows } = await pool.query(
      `select g.id, p.status as pedido_status, f.total as faturado,
              (select min(e.criado_em) from pedido_eventos e where e.pedido_id = p.id and e.status = 'FATURADO') as faturado_em,
              g.autorizado_em < now() - make_interval(hours => $2::int) as perto_de_vencer
         from pagamentos g join pedidos p on p.id = g.pedido_id
         left join pedido_faturamentos f on f.pedido_id = p.id
        where g.provedor = $1 and g.status = 'autorizado'
          and (g.captura_erro is null or g.atualizado_em < now() - interval '10 minutes')
        order by g.autorizado_em limit 30`,
      [provedor.nome, Math.max(1, Math.floor(limiteHoras))],
    );
    const faturados = ['FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE'];
    for (const p of rows) {
      try {
        let r: { status: string; mensagem: string } | null = null;
        if (p.pedido_status === 'CANCELADO') {
          r = await this.pagamentos.liberarReserva(pool, provedor, p.id, { motivo: 'pedido cancelado', origem: 'sistema' });
        } else if (faturados.includes(p.pedido_status) && p.faturado != null) {
          r = await this.pagamentos.cobrarReserva(pool, provedor, p.id, { motivo: 'valor da nota fiscal', origem: 'sistema' });
        } else if (faturados.includes(p.pedido_status) && p.faturado_em && Date.now() - new Date(p.faturado_em).getTime() > 6 * 3600_000) {
          r = await this.pagamentos.cobrarReserva(pool, provedor, p.id, { motivo: 'faturado sem o total da nota no ERP', origem: 'sistema' });
        } else if (p.perto_de_vencer) {
          r = await this.pagamentos.cobrarReserva(pool, provedor, p.id, { motivo: 'reserva perto de vencer, ainda sem nota', origem: 'sistema' });
        }
        if (r) {
          await pool.query(
            `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
             values ($1,'fluxo_para_erp',$2,$3,$4)`,
            [`${provedor.nome}_reserva`, p.id, `${r.status}: ${r.mensagem}`.slice(0, 500), r.status === 'cobrado' || r.status === 'liberado'],
          );
        }
      } catch (e) {
        this.log.warn(`reserva ${slug}/${p.id}: ${e}`);
      }
    }
  }

  /**
   * PIX não volta em dinheiro por padrão: vira crédito na carteira do app.
   * Pedido CANCELADO com PIX pago → crédito total; faturado menor que o pago
   * (já com a NF-e) → crédito da diferença. O cálculo final é refeito com a
   * linha travada em creditarPixNaCarteira; aqui é só o filtro de candidatos.
   */
  private async creditosPix(slug: string, pool: Pool, provedorNome: string) {
    const { rows } = await pool.query(
      `select g.id, case when p.status = 'CANCELADO' then 'cancelado' else 'diferenca' end as modo
         from pagamentos g join pedidos p on p.id = g.pedido_id
         left join pedido_faturamentos f on f.pedido_id = p.id
        where g.provedor = $1 and g.metodo = 'pix' and g.status = 'pago'
          and (p.status = 'CANCELADO'
               or (p.status in ('FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE') and f.total is not null
                   and coalesce(g.valor_pago, g.valor) + coalesce(p.valor_saldo_usado, 0) - f.total
                       - coalesce((select sum(e.valor) from pagamento_estornos e
                                    where e.pagamento_id = g.id and e.status in ('solicitado','concluido')), 0) >= 0.01))
        order by g.atualizado_em limit 20`,
      [provedorNome],
    );
    for (const p of rows) {
      try {
        const r = await this.pagamentos.creditarPixNaCarteira(pool, p.id, { modo: p.modo, origem: 'sistema' });
        if (r.creditado > 0) {
          await pool.query(
            `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
             values ('pix_credito_carteira','fluxo_para_erp',$1,$2,true)`,
            [p.id, `${p.modo}: R$ ${r.creditado.toFixed(2)}`],
          );
        }
      } catch (e) {
        this.log.warn(`crédito PIX ${slug}/${p.id}: ${e}`);
      }
    }
  }

  /**
   * Estorno automático: pedido CANCELADO (pelo ERP, ou cartão aprovado depois
   * que a janela já tinha vencido) com cartão ainda 'pago' → estorna o que falta.
   * Falha definitiva da Rede (prazo vencido, chargeback aberto...) para aqui e
   * aparece na retaguarda; falha passageira tenta de novo, no máximo 10 vezes.
   * Depois confere os estornos D+1 (360) que a Rede ainda não confirmou.
   */
  private async estornos(slug: string, pool: Pool, provedor: ProvedorCartao) {
    const { rows } = await pool.query(
      `select g.id from pagamentos g join pedidos p on p.id = g.pedido_id
        where g.provedor = $1 and g.metodo = 'cartao' and g.status = 'pago' and p.status = 'CANCELADO'
          and not exists (select 1 from pagamento_estornos e where e.pagamento_id = g.id and e.status = 'falhou' and not e.tentar_de_novo)
          and (select count(*) from pagamento_estornos e where e.pagamento_id = g.id and e.status = 'falhou') < 10
        order by g.atualizado_em limit 20`,
      [provedor.nome],
    );
    for (const p of rows) {
      try {
        const r = await this.pagamentos.estornarCartao(pool, provedor, p.id, { motivo: 'Pedido cancelado', origem: 'sistema' });
        await pool.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
           values ($1,'fluxo_para_erp',$2,$3,$4)`,
          [`${provedor.nome}_estorno`, p.id, `${r.status}: ${r.mensagem}`.slice(0, 500), r.status === 'concluido' || r.status === 'solicitado'],
        );
      } catch (e) {
        this.log.warn(`estorno automático ${slug}/${p.id}: ${e}`);
      }
    }
    const solicitados = await pool.query(
      `select id, provedor_ref from pagamentos where provedor = $1 and status = 'estorno_solicitado' and provedor_ref is not null
        order by atualizado_em limit 20`,
      [provedor.nome],
    );
    for (const p of solicitados.rows) {
      try {
        await this.pagamentos.confirmarEstornoSolicitado(pool, provedor, p);
      } catch (e) {
        this.log.warn(`confirmação de estorno ${slug}/${p.id}: ${e}`);
      }
    }
  }
}
