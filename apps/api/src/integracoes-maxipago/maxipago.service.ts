import { Injectable, Logger } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';

@Injectable()
export class MaxipagoService {
  private readonly logger = new Logger(MaxipagoService.name);

  /**
   * Grava o callback cru, sem parse. O formato real ainda é desconhecido
   * (falta a chave de integração e.Rede), e payload que não entendemos hoje
   * não pode ser descartado — é ele que vai definir o processamento depois.
   */
  async registrar(corpo: string, contentType?: string, ipOrigem?: string) {
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `insert into pagamento_webhooks (origem, content_type, corpo_bruto, ip_origem)
       values ('maxipago', $1, $2, $3) returning id`,
      [contentType ?? null, corpo, ipOrigem ?? null],
    );
    this.logger.log(`Callback MaxiPago registrado (tenant=${tenant.slug}, id=${rows[0].id})`);
    return { recebido: true };
  }
}
