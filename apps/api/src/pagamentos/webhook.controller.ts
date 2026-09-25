import { Controller, Headers, HttpCode, Ip, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

/**
 * Recebe o webhook do provedor, grava cru em pagamento_webhooks e responde 200.
 * O processamento é assíncrono (WebhooksProcessor) — provedor que recebe erro reenvia.
 */
@Controller('integracoes/pagamentos/:segredo')
export class WebhookController {
  private readonly log = new Logger('WebhookController');

  @Post(['webhook', 'webhook/pix'])
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('content-type') contentType: string | undefined, @Ip() ip: string) {
    const { pool, tenant } = tenantCtx();
    const corpo = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    const { rows } = await pool.query(
      `insert into pagamento_webhooks (origem, content_type, corpo_bruto, ip_origem) values ('itau_pix', $1, $2, $3) returning id`,
      [contentType ?? null, corpo, ip ?? null],
    );
    this.log.log(`webhook gravado (tenant=${tenant.slug}, id=${rows[0].id})`);
    return { recebido: true };
  }
}
