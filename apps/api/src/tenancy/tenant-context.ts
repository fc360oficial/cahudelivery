import { BadRequestException, Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import { DatabaseService, TenantInfo } from '../database/database.service';

export interface TenantContext {
  tenant: TenantInfo;
  pool: Pool;
}

const als = new AsyncLocalStorage<TenantContext>();

/** Contexto do tenant da request atual. Lança 400 se o header X-Tenant faltou. */
export function tenantCtx(): TenantContext {
  const ctx = als.getStore();
  if (!ctx) throw new BadRequestException('Header X-Tenant ausente');
  return ctx;
}

/** Executa uma função dentro de um contexto de tenant (usado pelo worker de outbox). */
export function runComTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return als.run(ctx, fn);
}

/**
 * Resolve o tenant no início de cada request (header X-Tenant = slug) e
 * disponibiliza o pool do banco correto via AsyncLocalStorage.
 * Isolamento: nenhuma query roda sem um tenant resolvido explicitamente.
 */
@Injectable()
export class TenancyMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const slug = (req.headers['x-tenant'] as string | undefined)?.toLowerCase().trim();
    if (!slug) return next(); // rotas sem tenant (healthz) — tenantCtx() barra o resto
    const tenant = await this.db.getTenant(slug);
    const pool = await this.db.getTenantPool(slug);
    als.run({ tenant, pool }, () => next());
  }
}
