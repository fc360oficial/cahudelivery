import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

export interface AdminLogado {
  usuarioId: string;
  papel: 'admin' | 'operador';
}

/** Exige usuário da retaguarda autenticado (token tipo 'admin' do mesmo tenant). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { admin?: AdminLogado }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(auth.slice(7));
      if (payload.tipo !== 'admin' || payload.slug !== tenantCtx().tenant.slug) {
        throw new ForbiddenException();
      }
      req.admin = { usuarioId: payload.sub, papel: payload.papel };
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException();
    }
  }
}
