import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Resolve o tenant pelo segredo que vai no próprio caminho da URL — a MaxiPago
 * chama de fora e não manda `X-Tenant` nem header customizado, então o segredo
 * é ao mesmo tempo credencial e identificação do tenant.
 * Rotacionar = trocar a linha em integracao_credenciais, sem deploy.
 */
@Injectable()
export class MaxipagoAuthMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // req.params não está populado em middleware do Nest; o segredo sai do path.
    const segredo = segredoDaUrl(req.originalUrl);
    if (!segredo) throw new UnauthorizedException('Segredo ausente');
    const hash = createHash('sha256').update(segredo).digest('hex');
    const { rows } = await this.db.controlPool().query(
      `select t.slug from integracao_credenciais ic
         join tenants t on t.id = ic.tenant_id
        where ic.apikey_hash = $1 and ic.ativo = true and ic.adaptador = 'maxipago'`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Segredo inválido');
    const tenant = await this.db.getTenant(rows[0].slug);
    const pool = await this.db.getTenantPool(rows[0].slug);
    await runComTenant({ tenant, pool }, async () => next());
  }
}

/** Extrai o segredo de /v1/integracoes/maxipago/<segredo>/webhook. */
function segredoDaUrl(url: string): string | undefined {
  const partes = url.split('?')[0].split('/').filter(Boolean);
  const i = partes.indexOf('maxipago');
  return i >= 0 ? partes[i + 1] : undefined;
}
