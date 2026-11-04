import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

const JANELA_MINUTOS = 15;
const MAX_POR_CONTA = 5;
const MAX_POR_IP = 30; // maior: vários clientes podem sair pelo mesmo IP

/** IP do cliente atrás do Caddy, que grava o X-Forwarded-For. */
export function ipDaRequisicao(req: Request): string {
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip || 'desconhecido';
}

/** Limite de erros em login e código de acesso, por conta (doc:/admin:) e por IP (ip:). */
@Injectable()
export class LimiteAuthService {
  async conferir(chaves: string[]) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select 1 from auth_tentativas where chave = any($1) and bloqueado_ate > now() limit 1`,
      [chaves],
    );
    if (rows[0]) {
      throw new HttpException(
        { statusCode: 429, message: `Muitas tentativas. Aguarde ${JANELA_MINUTOS} minutos e tente de novo.`, codigo: 'MUITAS_TENTATIVAS' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async registrarFalha(chaves: string[]) {
    const { pool } = tenantCtx();
    for (const chave of chaves) {
      await pool.query(
        `insert into auth_tentativas as t (chave, falhas, janela_em, bloqueado_ate)
         values ($1, 1, now(), null)
         on conflict (chave) do update set
           falhas = case when t.janela_em < now() - make_interval(mins => $2) then 1 else t.falhas + 1 end,
           janela_em = case when t.janela_em < now() - make_interval(mins => $2) then now() else t.janela_em end,
           bloqueado_ate = case
             when t.janela_em >= now() - make_interval(mins => $2) and t.falhas + 1 >= $3
             then now() + make_interval(mins => $2) else null end`,
        [chave, JANELA_MINUTOS, chave.startsWith('ip:') ? MAX_POR_IP : MAX_POR_CONTA],
      );
    }
    await pool.query(`delete from auth_tentativas where janela_em < now() - interval '1 day'`);
  }

  async limpar(chave: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from auth_tentativas where chave = $1`, [chave]);
  }
}
