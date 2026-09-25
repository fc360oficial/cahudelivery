import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorPagamento } from './provedor-pagamento';

/** Lê pagamento_webhooks não processados do tenant e aplica as confirmações. */
@Injectable()
export class WebhooksProcessor {
  private readonly log = new Logger('WebhooksProcessor');

  constructor(private readonly pagamentos: PagamentosService) {}

  async processar(pool: Pool, provedor: ProvedorPagamento): Promise<void> {
    const { rows } = await pool.query(
      `select id, corpo_bruto from pagamento_webhooks where processado = false order by recebido_em limit 20`,
    );
    for (const wh of rows) {
      const erros: string[] = [];
      try {
        const recebidos = provedor.tratarWebhook(wh.corpo_bruto);
        if (recebidos.length === 0) erros.push('corpo sem confirmações reconhecidas');
        for (const r of recebidos) {
          const pag = await pool.query(
            `select id, expira_em from pagamentos where provedor = $1 and provedor_ref = $2`,
            [provedor.nome, r.ref],
          );
          if (!pag.rows[0]) { erros.push(`ref ${r.ref} não encontrada`); continue; }
          await this.pagamentos.confirmarPago(pool, pag.rows[0].id, r.valorPago, r.pagoEm);
        }
      } catch (e) {
        erros.push(String(e).slice(0, 300));
      }
      try {
        await pool.query(`update pagamento_webhooks set processado = true, erro = $2 where id = $1`, [wh.id, erros.length ? erros.join('; ') : null]);
      } catch (e) {
        this.log.error(`falha ao marcar webhook ${wh.id} como processado: ${String(e).slice(0, 300)}`);
      }
      if (erros.length) this.log.warn(`webhook ${wh.id}: ${erros.join('; ')}`);
    }
  }
}
