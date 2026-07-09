import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

export interface ClienteLogado {
  clienteId: string;
}

async function extrair(jwt: JwtService, req: Request): Promise<ClienteLogado | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = await jwt.verifyAsync(auth.slice(7));
    // token de um tenant não vale em outro
    if (payload.tipo !== 'cliente' || payload.slug !== tenantCtx().tenant.slug) return null;
    return { clienteId: payload.sub };
  } catch {
    return null;
  }
}

/** Exige cliente autenticado; anexa req.cliente. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { cliente?: ClienteLogado }>();
    const cliente = await extrair(this.jwt, req);
    if (!cliente) throw new UnauthorizedException();
    req.cliente = cliente;
    return true;
  }
}

/** Autenticação opcional: anexa req.cliente se houver token válido (preço por cliente no catálogo). */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { cliente?: ClienteLogado }>();
    req.cliente = (await extrair(this.jwt, req)) ?? undefined;
    return true;
  }
}
