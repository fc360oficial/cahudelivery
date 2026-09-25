import { Controller, Headers, HttpCode, Ip, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';
import { ProvedoresService } from './provedores.service';

/**
 * Recebe o webhook do provedor, grava cru em pagamento_webhooks e responde 200.
 * O processamento é assíncrono (WebhooksProcessor) — provedor que recebe erro reenvia.
 */
@Controller('integracoes/pagamentos/:segredo')
export class WebhookController {
  private readonly log = new Logger('WebhookController');

  constructor(private readonly provedores: ProvedoresService) {}

  @Post(['webhook', 'webhook/pix'])
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('content-type') contentType: string | undefined, @Ip() ip: string) {
    const { pool, tenant } = tenantCtx();
    const corpo = corpoComoTexto(req.body);
    if (!corpo) this.log.warn(`webhook com corpo vazio (content-type=${contentType})`);
    // Tabela também recebe callbacks do MaxiPago (T027); origem precisa refletir o provedor
    // real do tenant pra o WebhooksProcessor filtrar certo. Uma credencial quebrada aqui não
    // pode derrubar o recebimento do webhook — o Itaú reenvia com erro, e dinheiro real está
    // em jogo: melhor gravar como 'desconhecida' e responder 200 do que falhar a request.
    let origem = 'desconhecida';
    try {
      const pt = await this.provedores.obter(tenant.slug);
      origem = pt?.provedor.nome ?? 'desconhecida';
    } catch (e) {
      this.log.error(`falha ao obter provedor do tenant ${tenant.slug}: ${e}`);
    }
    const { rows } = await pool.query(
      `insert into pagamento_webhooks (origem, content_type, corpo_bruto, ip_origem) values ($1, $2, $3, $4) returning id`,
      [origem, contentType ?? null, corpo, ip ?? null],
    );
    this.log.log(`webhook gravado (tenant=${tenant.slug}, id=${rows[0].id})`);
    return { recebido: true };
  }
}

/** JSON já vem desserializado pelo body parser; texto cru (registrado antes do json em main.ts) chega como string. */
function corpoComoTexto(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  return JSON.stringify(body);
}
