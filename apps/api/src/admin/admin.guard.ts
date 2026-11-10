import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';
import {
  Solucao,
  caminhoDaRequisicao,
  solucaoExigida,
  solucoesEfetivas,
} from './solucoes';

export interface AdminLogado {
  usuarioId: string;
  papel: 'admin' | 'operador';
  solucoes: Solucao[];
}

/** Exige usuário da retaguarda autenticado (token tipo 'admin' do mesmo tenant). */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { admin?: AdminLogado }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: { sub: string; slug: string; tipo: string };
    try {
      payload = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    const { pool, tenant } = tenantCtx();
    if (payload.tipo !== 'admin' || payload.slug !== tenant.slug)
      throw new ForbiddenException();
    // Papel, situação e soluções vêm do banco: desativar ou mudar o acesso vale na hora.
    const { rows } = await pool.query(
      `select papel, ativo, solucoes from usuarios_admin where id = $1`,
      [payload.sub],
    );
    const u = rows[0];
    if (!u || !u.ativo) throw new UnauthorizedException();
    const solucoes = solucoesEfetivas(u.papel, u.solucoes);
    const caminho = caminhoDaRequisicao(req.originalUrl ?? req.url ?? '');
    // Alvo ilegível: tratado como rota que exige uma solução que ninguém tem.
    const exigida =
      caminho === null ? ('invalida' as Solucao) : solucaoExigida(caminho);
    if (exigida && !solucoes.includes(exigida)) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Sem acesso a esta solução',
        codigo: 'SEM_ACESSO_A_SOLUCAO',
      });
    }
    req.admin = { usuarioId: payload.sub, papel: u.papel, solucoes };
    return true;
  }
}
