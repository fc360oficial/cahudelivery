import {
  Body, CanActivate, Controller, ExecutionContext, Headers, HttpCode, Injectable, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { IsNotEmpty, IsString } from 'class-validator';
import type { Request } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { ipDaRequisicao, LimiteAuthService } from '../auth/limite-auth.service';
import { tenantCtx } from '../tenancy/tenant-context';

/** O motorista passa o dia na rua, às vezes sem sinal: a sessão dura 30 dias sem falar com o servidor (igual ao vendedor). */
const REFRESH_DIAS_MOTORISTA = 30;

export interface TokensMotorista { accessToken: string; refreshToken: string }
export interface MotoristaLogado { motoristaId: string }

const versao = (v?: string) => v?.slice(0, 40) || null;

@Injectable()
export class MotoristaAuthService {
  constructor(private readonly jwt: JwtService, private readonly limite: LimiteAuthService) {}

  async login(loginInformado: string, senha: string, ip: string, appVersao?: string) {
    const { pool, tenant } = tenantCtx();
    const login = loginInformado.trim().toLowerCase();
    const chaves = [`mot:${login}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    const { rows } = await pool.query(`select id, nome, senha_hash, ativo from motoristas where login = $1`, [login]);
    const m = rows[0];
    if (!m || !m.ativo || !m.senha_hash || !(await argon2.verify(m.senha_hash, senha))) {
      await this.limite.registrarFalha(chaves);
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }
    await this.limite.limpar(chaves[0]);
    await pool.query(`update motoristas set ultimo_acesso_em = now(), app_versao = coalesce($2, app_versao) where id = $1`, [m.id, versao(appVersao)]);
    const tokens = await this.emitir(m.id, tenant.slug);
    return { ...tokens, motorista: { id: m.id, nome: m.nome }, distribuidora: tenant.nomeFantasia };
  }

  /** Rotação com tolerância de 30 s (duas abas, rede lenta), só para motorista ativo. */
  async refresh(refreshToken: string, appVersao?: string): Promise<TokensMotorista> {
    const { pool, tenant } = tenantCtx();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await pool.query(
      `update refresh_tokens r set revogado_em = coalesce(r.revogado_em, now())
         from motoristas m
        where r.token_hash = $1 and r.sujeito = 'motorista' and r.expira_em > now()
          and (r.revogado_em is null or r.revogado_em > now() - interval '30 seconds')
          and m.id = r.sujeito_id and m.ativo
        returning r.sujeito_id`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    await pool.query(`update motoristas set ultimo_acesso_em = now(), app_versao = coalesce($2, app_versao) where id = $1`, [rows[0].sujeito_id, versao(appVersao)]);
    return this.emitir(rows[0].sujeito_id, tenant.slug);
  }

  private async emitir(motoristaId: string, slug: string): Promise<TokensMotorista> {
    const { pool } = tenantCtx();
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (sujeito_id, sujeito, token_hash, expira_em)
       values ($1,'motorista',$2, now() + interval '${REFRESH_DIAS_MOTORISTA} days')`,
      [motoristaId, createHash('sha256').update(refreshToken).digest('hex')],
    );
    const accessToken = await this.jwt.signAsync({ sub: motoristaId, slug, tipo: 'motorista' });
    return { accessToken, refreshToken };
  }
}

/**
 * Exige motorista autenticado (token tipo 'motorista' do mesmo tenant) e ainda ativo.
 * A consulta a cada requisição faz o bloqueio na retaguarda valer na hora.
 */
@Injectable()
export class MotoristaGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { motorista?: MotoristaLogado }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: { sub: string; slug: string; tipo: string };
    try {
      payload = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    const { pool, tenant } = tenantCtx();
    if (payload.tipo !== 'motorista' || payload.slug !== tenant.slug) throw new UnauthorizedException();
    const { rowCount } = await pool.query(`select 1 from motoristas where id = $1 and ativo`, [payload.sub]);
    if (!rowCount) throw new UnauthorizedException({ statusCode: 401, message: 'Acesso desativado', codigo: 'MOTORISTA_DESATIVADO' });
    req.motorista = { motoristaId: payload.sub };
    return true;
  }
}

class LoginMotoristaDto {
  @IsString() @IsNotEmpty() login!: string;
  @IsString() @IsNotEmpty() senha!: string;
}

class RefreshMotoristaDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

@Controller('motorista')
export class MotoristaAuthController {
  constructor(private readonly auth: MotoristaAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request, @Body() dto: LoginMotoristaDto, @Headers('x-app-versao') appVersao?: string) {
    return this.auth.login(dto.login, dto.senha, ipDaRequisicao(req), appVersao);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshMotoristaDto, @Headers('x-app-versao') appVersao?: string) {
    return this.auth.refresh(dto.refreshToken, appVersao);
  }
}
