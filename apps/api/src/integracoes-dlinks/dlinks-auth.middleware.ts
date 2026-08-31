import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Resolve o tenant a partir do header `apikey` (não `X-Tenant`) — usado só
 * nas rotas chamadas pelo Dlinks, que não conhece nosso conceito de tenant.
 */
@Injectable()
export class DlinksAuthMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const apikey = req.headers['apikey'] as string | undefined;
    if (!apikey) throw new UnauthorizedException('Header apikey ausente');
    const hash = createHash('sha256').update(apikey).digest('hex');
    const { rows } = await this.db.controlPool().query(
      `select t.slug from integracao_credenciais ic
         join tenants t on t.id = ic.tenant_id
        where ic.apikey_hash = $1 and ic.ativo = true`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('apikey inválida');
    const tenant = await this.db.getTenant(rows[0].slug);
    const pool = await this.db.getTenantPool(rows[0].slug);
    await runComTenant({ tenant, pool }, async () => next());
  }
}
