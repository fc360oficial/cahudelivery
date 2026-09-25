import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PagamentosService } from './pagamentos.service';
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
        const pt = await this.provedores.obter(slug);
        if (!pt) continue;
        const pool = await this.db.getTenantPool(slug);
        await this.webhooks.processar(pool, pt.provedor);
        const { rows } = await pool.query(
          `select id, provedor_ref, expira_em from pagamentos
            where status = 'pendente' and provedor = $1 order by criado_em limit 50`,
          [pt.provedor.nome],
        );
        for (const p of rows) {
          const ini = Date.now();
          try {
            const s = await pt.provedor.consultar(p.provedor_ref);
            await this.pagamentos.aplicarSituacao(pool, p, s);
            await pool.query(
              `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
               values ('itau_pix_consulta','fluxo_para_erp',$1,$2,true,$3)`,
              [p.provedor_ref, s.status, Date.now() - ini],
            );
          } catch (e) {
            this.log.warn(`consulta ${slug}/${p.provedor_ref}: ${e}`);
            await pool.query(
              `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
               values ('itau_pix_consulta','fluxo_para_erp',$1,$2,false,$3)`,
              [p.provedor_ref, String(e).slice(0, 500), Date.now() - ini],
            );
          }
        }
      }
    } catch (e) {
      this.log.error(e);
    } finally {
      this.rodando = false;
    }
  }
}
