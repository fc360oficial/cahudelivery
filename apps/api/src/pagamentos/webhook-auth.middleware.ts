import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';
import { ProvedoresService } from './provedores.service';

/** Tenant vem do segredo no caminho: /v1/integracoes/pagamentos/<segredo>/webhook[/pix]. */
@Injectable()
export class WebhookAuthMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService, private readonly provedores: ProvedoresService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const segredo = segredoDaUrl(req.originalUrl);
    if (!segredo) throw new UnauthorizedException('Segredo ausente');
    const hash = createHash('sha256').update(segredo).digest('hex');
    const slug = await this.provedores.slugPorSegredoHash(hash);
    if (!slug) throw new UnauthorizedException('Segredo inválido');
    const tenant = await this.db.getTenant(slug);
    const pool = await this.db.getTenantPool(slug);
    await runComTenant({ tenant, pool }, async () => next());
  }
}

function segredoDaUrl(url: string): string | undefined {
  const partes = url.split('?')[0].split('/').filter(Boolean);
  const i = partes.indexOf('pagamentos');
  return i >= 0 ? partes[i + 1] : undefined;
}
