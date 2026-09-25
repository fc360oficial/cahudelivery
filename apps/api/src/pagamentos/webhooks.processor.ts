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
      `select id, corpo_bruto from pagamento_webhooks where processado = false and origem = $1 order by recebido_em limit 20`,
      [provedor.nome],
    );
    for (const wh of rows) {
      const erros: string[] = [];
      try {
        const recebidos = provedor.tratarWebhook(wh.corpo_bruto);
        if (recebidos.length === 0) erros.push('corpo sem confirmações reconhecidas');
        for (const r of recebidos) {
          const pag = await pool.query(
            `select id, expira_em, status from pagamentos where provedor = $1 and provedor_ref = $2`,
            [provedor.nome, r.ref],
          );
          const row = pag.rows[0];
          if (!row) { erros.push(`ref ${r.ref} não encontrada`); continue; }
          // O webhook é só um gatilho: quem manda na verdade é o que o provedor responde agora.
          const s = await provedor.consultar(r.ref);
          await this.pagamentos.aplicarSituacao(pool, row, s);
          const atual = await pool.query(`select status from pagamentos where id = $1`, [row.id]);
          const statusFinal = atual.rows[0]?.status;
          if (statusFinal !== 'pago') {
            const msg = `ref ${r.ref}: provedor confirmou mas pagamento ficou ${statusFinal}`;
            erros.push(msg);
            this.log.error(msg);
          }
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
