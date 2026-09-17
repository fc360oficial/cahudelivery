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

/**
 * Autenticação opcional: sem Authorization segue como visitante (carrinho por
 * X-Device-Id, preço da tabela padrão). Com Authorization presente, o token TEM
 * que ser válido: token vencido/de outro tenant responde 401 pro app renovar e
 * repetir a chamada. Rebaixar silenciosamente pra visitante fazia os itens do
 * cliente logado (access token de 15 min vencido) irem pro carrinho do aparelho,
 * e o "Confirmar pedido" (JwtAuthGuard) achava o carrinho do cliente vazio.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { cliente?: ClienteLogado }>();
    if (!req.headers.authorization) {
      req.cliente = undefined;
      return true;
    }
    const cliente = await extrair(this.jwt, req);
    if (!cliente) throw new UnauthorizedException();
    req.cliente = cliente;
    return true;
  }
}
