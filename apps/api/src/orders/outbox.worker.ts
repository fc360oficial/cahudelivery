import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { IntegrationService } from '../integration/integration.service';
import { creditarIndicacao } from './creditar-indicacao';

const MAX_TENTATIVAS = 5;

/**
 * Processa a outbox (envio de pedidos ao ERP) e sincroniza status/cobrança/NF.
 * Padrão outbox transacional: o pedido só entra aqui se foi gravado com sucesso;
 * falhas geram retry até MAX_TENTATIVAS e depois FALHA_INTEGRACAO (reenvio manual).
 * Transporte por polling em dev; BullMQ/Redis entra na fase de escala sem mudar a semântica.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OutboxWorker');
  private timers: NodeJS.Timeout[] = [];
  private rodando = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly erp: IntegrationService,
  ) {}

  onModuleInit() {
    if (process.env.OUTBOX_DESLIGADO === 'true') return;
    this.timers.push(setInterval(() => this.tick(() => this.processarOutbox()), 5_000));
    this.timers.push(setInterval(() => this.tick(() => this.sincronizarStatus()), 30_000));
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  private async tick(fn: () => Promise<void>) {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await fn();
    } catch (e) {
      this.log.error(e);
    } finally {
      this.rodando = false;
    }
  }

  private async processarOutbox() {
    for (const slug of await this.db.listActiveTenantSlugs()) {
      const pool = await this.db.getTenantPool(slug);
      const adapter = await this.erp.getAdapter(slug);
      const { rows } = await pool.query(
        `select o.id, o.agregado_id, o.tentativas from sync_outbox o
          where o.processado_em is null and o.evento = 'pedido_criado' order by o.criado_em limit 10`,
      );
      for (const ev of rows) {
        if (adapter.capacidades.suportaPull) {
          // Adaptador pull (ex.: Dlinks): não empurramos, o pedido fica em
          // RECEBIDO até o ERP confirmar via POST /integracoes/dlinks/pedidos/recebido.
          await pool.query(`update sync_outbox set processado_em = now() where id = $1`, [ev.id]);
          continue;
        }
        const ini = Date.now();
        try {
          const ped = await pool.query(
            `select p.id, p.forma_pagamento, p.tipo_entrega, p.observacoes, p.endereco_snapshot_json,
                    p.valor_saldo_usado,
                    coalesce(c.erp_cliente_id, c.documento) as erp_cliente_id,
                    (select json_agg(json_build_object(
                        'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                        'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                       from pedido_itens i join produtos pr on pr.id = i.produto_id
                      where i.pedido_id = p.id) as itens
               from pedidos p join clientes c on c.id = p.cliente_id where p.id = $1`,
            [ev.agregado_id],
          );
          const p = ped.rows[0];
          const { erpPedidoId } = await adapter.enviarPedido({
            fluxoPedidoId: p.id,
            erpClienteId: p.erp_cliente_id,
            formaPagamento: p.forma_pagamento,
            tipoEntrega: p.tipo_entrega,
            observacoes: p.observacoes ?? undefined,
            enderecoEntrega: p.endereco_snapshot_json ?? undefined,
            itens: p.itens ?? [],
            valorAbatidoSaldo: Number(p.valor_saldo_usado) || undefined,
          });
          await pool.query(`update pedidos set status = 'ENVIADO_ERP', erp_pedido_id = $2 where id = $1`, [p.id, erpPedidoId]);
          await pool.query(
            `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'ENVIADO_ERP',$2,'sistema')`,
            [p.id, `Pedido ${erpPedidoId} criado no ERP`],
          );
          await pool.query(`update sync_outbox set processado_em = now() where id = $1`, [ev.id]);
          await this.logar(pool, 'enviarPedido', true, Date.now() - ini, `pedido ${p.id} -> ${erpPedidoId}`);
        } catch (e) {
          const tentativas = ev.tentativas + 1;
          const esgotou = tentativas >= MAX_TENTATIVAS;
          await pool.query(
            `update sync_outbox set tentativas = $2, processado_em = case when $3 then now() else null end where id = $1`,
            [ev.id, tentativas, esgotou],
          );
          if (esgotou) {
            await pool.query(`update pedidos set status = 'FALHA_INTEGRACAO' where id = $1`, [ev.agregado_id]);
            await pool.query(
              `insert into pedido_eventos (pedido_id, status, detalhe, origem)
               values ($1,'FALHA_INTEGRACAO','Falha após ${MAX_TENTATIVAS} tentativas — reenviar pela retaguarda','sistema')`,
              [ev.agregado_id],
            );
          }
          await this.logar(pool, 'enviarPedido', false, Date.now() - ini, String(e));
        }
      }
    }
  }

  private async sincronizarStatus() {
    for (const slug of await this.db.listActiveTenantSlugs()) {
      const pool = await this.db.getTenantPool(slug);
      const adapter = await this.erp.getAdapter(slug);
      const { rows } = await pool.query(
        `select id, erp_pedido_id, status, forma_pagamento from pedidos
          where erp_pedido_id is not null and status in ('ENVIADO_ERP','FATURADO','EM_SEPARACAO','SAIU_ENTREGA') limit 50`,
      );
      for (const p of rows) {
        try {
          const st = await adapter.consultarStatusPedido(p.erp_pedido_id);
          if (st.status !== p.status) {
            await pool.query(`update pedidos set status = $2 where id = $1`, [p.id, st.status]);
            await pool.query(
              `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'erp')`,
              [p.id, st.status, st.detalhe ?? null],
            );
            if (st.status === 'FATURADO') {
              await creditarIndicacao(pool, p.id);
            }
          }
          if (st.status !== 'ENVIADO_ERP') {
            const [cob, nf] = await Promise.all([adapter.obterCobranca(p.erp_pedido_id), adapter.obterNotaFiscal(p.erp_pedido_id)]);
            if (cob)
              await pool.query(
                `insert into pedido_cobrancas (pedido_id, tipo, linha_digitavel, pix_copia_cola, pdf_url, valor, vencimento, pago_em)
                 values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (pedido_id) do update set pago_em = excluded.pago_em`,
                [p.id, cob.tipo, cob.linhaDigitavel ?? null, cob.pixCopiaCola ?? null, cob.pdfUrl ?? null, cob.valor, cob.vencimento ?? null, cob.pagoEm ?? null],
              );
            if (nf)
              await pool.query(
                `insert into pedido_notas (pedido_id, numero_nf, chave_acesso, xml_url, pdf_url, emitida_em)
                 values ($1,$2,$3,$4,$5,$6) on conflict (pedido_id) do nothing`,
                [p.id, nf.numeroNf, nf.chaveAcesso ?? null, nf.xmlUrl ?? null, nf.pdfUrl ?? null, nf.emitidaEm ?? null],
              );
          }
        } catch (e) {
          this.log.warn(`status ${slug}/${p.erp_pedido_id}: ${e}`);
        }
      }
    }
  }

  private async logar(pool: import('pg').Pool, operacao: string, sucesso: boolean, duracaoMs: number, resumo: string) {
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso, duracao_ms)
       values ($1,'fluxo_para_erp',$2,$3,$4)`,
      [operacao, resumo.slice(0, 500), sucesso, duracaoMs],
    );
  }
}
