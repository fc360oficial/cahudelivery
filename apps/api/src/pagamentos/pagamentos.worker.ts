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
              `select id, provedor_ref, expira_em, metodo from pagamentos
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
            if (ehProvedorCartao(pt.provedor)) await this.estornos(slug, pool, pt.provedor);
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
