import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { tenantCtx } from '../tenancy/tenant-context';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const REFRESH_DIAS = 30;

@Injectable()
export class AuthService {
  constructor(private readonly jwt: JwtService) {}

  async registrar(dados: {
    tipo: 'CPF' | 'CNPJ';
    documento: string;
    nomeFantasia: string;
    razaoSocial?: string;
    email: string;
    telefone?: string;
    senha: string;
  }) {
    const { pool } = tenantCtx();
    const doc = dados.documento.replace(/\D/g, '');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const dup = await client.query(`select 1 from clientes where documento = $1 or email = $2`, [
        doc,
        dados.email.toLowerCase(),
      ]);
      if (dup.rowCount) throw new ConflictException('Documento ou e-mail já cadastrado');
      const { rows } = await client.query(
        `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, telefone)
         values ($1,$2,$3,$4,$5,$6) returning id, status`,
        [dados.tipo, doc, dados.razaoSocial ?? null, dados.nomeFantasia, dados.email.toLowerCase(), dados.telefone ?? null],
      );
      await client.query(`insert into cliente_credenciais (cliente_id, senha_hash) values ($1,$2)`, [
        rows[0].id,
        await argon2.hash(dados.senha),
      ]);
      await client.query('commit');
      return { clienteId: rows[0].id, status: rows[0].status };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async login(identificador: string, senha: string): Promise<TokenPair & { status: string }> {
    const { pool, tenant } = tenantCtx();
    const doc = identificador.replace(/\D/g, '');
    const { rows } = await pool.query(
      `select c.id, c.status, cc.senha_hash
         from clientes c join cliente_credenciais cc on cc.cliente_id = c.id
        where c.email = $1 or c.documento = $2`,
      [identificador.toLowerCase(), doc.length ? doc : identificador],
    );
    const reg = rows[0];
    if (!reg || !(await argon2.verify(reg.senha_hash, senha))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    if (reg.status === 'bloqueado') throw new UnauthorizedException('Cadastro bloqueado');
    await pool.query(`update cliente_credenciais set ultimo_login_em = now() where cliente_id = $1`, [reg.id]);
    return { ...(await this.emitirTokens(reg.id, tenant.slug)), status: reg.status };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const { pool, tenant } = tenantCtx();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await pool.query(
      `update refresh_tokens set revogado_em = now()
        where token_hash = $1 and revogado_em is null and expira_em > now()
        returning sujeito_id`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Refresh token inválido ou expirado');
    return this.emitirTokens(rows[0].sujeito_id, tenant.slug);
  }

  private async emitirTokens(clienteId: string, slug: string): Promise<TokenPair> {
    const { pool } = tenantCtx();
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (sujeito_id, sujeito, token_hash, expira_em)
       values ($1,'cliente',$2, now() + interval '${REFRESH_DIAS} days')`,
      [clienteId, createHash('sha256').update(refreshToken).digest('hex')],
    );
    const accessToken = await this.jwt.signAsync({ sub: clienteId, slug, tipo: 'cliente' });
    return { accessToken, refreshToken };
  }
}
