import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Resolve o tenant pelo slug no caminho da URL. O navegador externo abre estas
 * URLs sem header nenhum (o app usa launchUrl), então o X-Tenant que o
 * TenancyMiddleware espera nunca chega. Mesmo padrão do webhook da MaxiPago —
 * com a diferença de que aqui o slug é público e quem credencia é o HMAC.
 */
@Injectable()
export class NotasTenantMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // req.params não está populado em middleware do Nest; o slug sai do path.
    const partes = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const slug = partes[partes.indexOf('notas') + 1]?.toLowerCase();
    if (!slug) throw new NotFoundException();
    try {
      const tenant = await this.db.getTenant(slug);
      const pool = await this.db.getTenantPool(slug);
      await runComTenant({ tenant, pool }, async () => next());
    } catch {
      // Tenant inexistente responde 404 igual a pedido inexistente — não
      // confirma para quem está sondando quais slugs existem.
      throw new NotFoundException();
    }
  }
}
