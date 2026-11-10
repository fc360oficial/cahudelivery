import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { LimiteAuthService } from '../auth/limite-auth.service';
import { tenantCtx } from '../tenancy/tenant-context';

/** Vendedor trabalha offline: a sessão sobrevive 30 dias sem falar com o servidor. */
const REFRESH_DIAS_VENDEDOR = 30;

export interface TokensVendedor {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class VendasAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly limite: LimiteAuthService,
  ) {}

  async login(loginInformado: string, senha: string, ip: string) {
    const { pool, tenant } = tenantCtx();
    const login = loginInformado.trim().toLowerCase();
    const chaves = [`vend:${login}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    const { rows } = await pool.query(`select id, nome, senha_hash, ativo, acesso_bloqueado from vendedores where login = $1`, [login]);
    const v = rows[0];
    if (!v || !v.ativo || v.acesso_bloqueado || !v.senha_hash || !(await argon2.verify(v.senha_hash, senha))) {
      await this.limite.registrarFalha(chaves);
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }
    await this.limite.limpar(chaves[0]);
    const tokens = await this.emitir(v.id, tenant.slug);
    return { ...tokens, vendedor: { id: v.id, nome: v.nome }, distribuidora: tenant.nomeFantasia };
  }

  /** Mesma rotação com tolerância de 30 s do app do cliente, restrita a tokens de vendedor ativo. */
  async refresh(refreshToken: string): Promise<TokensVendedor> {
    const { pool, tenant } = tenantCtx();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await pool.query(
      `update refresh_tokens r set revogado_em = coalesce(r.revogado_em, now())
         from vendedores v
        where r.token_hash = $1 and r.sujeito = 'vendedor' and r.expira_em > now()
          and (r.revogado_em is null or r.revogado_em > now() - interval '30 seconds')
          and v.id = r.sujeito_id and v.ativo and not v.acesso_bloqueado
        returning r.sujeito_id`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    return this.emitir(rows[0].sujeito_id, tenant.slug);
  }

  private async emitir(vendedorId: string, slug: string): Promise<TokensVendedor> {
    const { pool } = tenantCtx();
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (sujeito_id, sujeito, token_hash, expira_em)
       values ($1,'vendedor',$2, now() + interval '${REFRESH_DIAS_VENDEDOR} days')`,
      [vendedorId, createHash('sha256').update(refreshToken).digest('hex')],
    );
    const accessToken = await this.jwt.signAsync({ sub: vendedorId, slug, tipo: 'vendedor' });
    return { accessToken, refreshToken };
  }
}
