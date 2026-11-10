import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

export interface VendedorLogado {
  vendedorId: string;
}

/**
 * Exige vendedor autenticado (token tipo 'vendedor' do mesmo tenant) e ainda ativo.
 * A consulta ao banco a cada request faz a desativação na retaguarda valer na hora.
 */
@Injectable()
export class VendedorGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { vendedor?: VendedorLogado }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: { sub: string; slug: string; tipo: string };
    try {
      payload = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    const { pool, tenant } = tenantCtx();
    if (payload.tipo !== 'vendedor' || payload.slug !== tenant.slug) throw new UnauthorizedException();
    const { rowCount } = await pool.query(`select 1 from vendedores where id = $1 and ativo and not acesso_bloqueado`, [payload.sub]);
    if (!rowCount) throw new UnauthorizedException({ statusCode: 401, message: 'Acesso desativado', codigo: 'VENDEDOR_DESATIVADO' });
    req.vendedor = { vendedorId: payload.sub };
    return true;
  }
}
