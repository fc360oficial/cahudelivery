import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminVendasController } from './admin-vendas.controller';

const ADMIN = { admin: { usuarioId: 'u1', papel: 'admin' } } as never;
const OPERADOR = { admin: { usuarioId: 'u2', papel: 'operador' } } as never;

function montar(opcoes: { loginEmUso?: boolean; updateRowCount?: number; falhaEm?: { trecho: string; code: string } } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (opcoes.falhaEm && sql.includes(opcoes.falhaEm.trecho)) throw Object.assign(new Error('falha'), { code: opcoes.falhaEm.code });
    if (sql.includes('from vendedores where login = $1 and id <> $2')) return { rowCount: opcoes.loginEmUso ? 1 : 0, rows: [] };
    if (sql.includes('update vendedores set login')) return { rowCount: opcoes.updateRowCount ?? 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
  const params = (trecho: string) => query.mock.calls.find(([sql]) => String(sql).includes(trecho))?.[1] as unknown[];
  const chamou = (trecho: string) => query.mock.calls.some(([sql]) => String(sql).includes(trecho));
  return { controller: new AdminVendasController(), rodar, params, chamou, query };
}

describe('AdminVendasController.definirAcesso', () => {
  it('grava o login em minúsculas, a senha com argon2 e encerra as sessões abertas', async () => {
    const { controller, rodar, params, chamou, query } = montar();
    await rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: ' Ana.Paula ', senha: 'segredo123', ativo: true } as never));
    const p = params('update vendedores set login');
    expect(p[0]).toBe('vend-1');
    expect(p[1]).toBe('ana.paula');
    expect(await argon2.verify(String(p[2]), 'segredo123')).toBe(true);
    expect(p[3]).toBe(true);
    expect(String(query.mock.calls.find(([sql]) => String(sql).includes('update vendedores set login'))![0])).toContain('acesso_bloqueado = not $4');
    expect(chamou("delete from refresh_tokens where sujeito_id = $1 and sujeito = 'vendedor'")).toBe(true);
  });

  it('sem senha nova mantém a senha atual e as sessões', async () => {
    const { controller, rodar, params, chamou } = montar();
    await rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: true } as never));
    expect(params('update vendedores set login')[2]).toBeNull();
    expect(chamou('delete from refresh_tokens')).toBe(false);
  });

  it('desativar encerra as sessões mesmo sem trocar a senha', async () => {
    const { controller, rodar, chamou } = montar();
    await rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: false } as never));
    expect(chamou('delete from refresh_tokens')).toBe(true);
  });

  it('recusa login já usado por outro vendedor', async () => {
    const { controller, rodar } = montar({ loginEmUso: true });
    await expect(rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: true } as never))).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa operador sem fazer nenhuma consulta', async () => {
    const { controller, rodar, chamou } = montar();
    await expect(rodar(() => controller.definirAcesso(OPERADOR, 'vend-1', { login: 'ana', ativo: true } as never))).rejects.toBeInstanceOf(ForbiddenException);
    expect(chamou('')).toBe(false);
  });

  it('login duplicado numa corrida (23505) vira 409', async () => {
    const { controller, rodar } = montar({ falhaEm: { trecho: 'update vendedores set login', code: '23505' } });
    await expect(rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: true } as never))).rejects.toBeInstanceOf(ConflictException);
  });

  it('outro erro do update é repassado', async () => {
    const { controller, rodar } = montar({ falhaEm: { trecho: 'update vendedores set login', code: '99999' } });
    await expect(rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: true } as never))).rejects.toThrow('falha');
  });

  it('vendedor inexistente (rowCount 0) vira 404', async () => {
    const { controller, rodar } = montar({ updateRowCount: 0 });
    await expect(rodar(() => controller.definirAcesso(ADMIN, 'vend-1', { login: 'ana', ativo: true } as never))).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminVendasController.definirCondicoes', () => {
  it('troca todas as condições da tabela', async () => {
    const { controller, rodar, params, chamou } = montar();
    await rodar(() => controller.definirCondicoes(ADMIN, 'tab-1', { condicaoIds: ['c1', 'c2'] } as never));
    expect(params('delete from tabela_preco_condicoes')).toEqual(['tab-1']);
    expect(chamou('insert into tabela_preco_condicoes')).toBe(true);
    expect(params('insert into tabela_preco_condicoes')).toEqual(['tab-1', ['c1', 'c2']]);
  });

  it('recusa operador sem fazer nenhuma consulta', async () => {
    const { controller, rodar, chamou } = montar();
    await expect(rodar(() => controller.definirCondicoes(OPERADOR, 'tab-1', { condicaoIds: [] } as never))).rejects.toBeInstanceOf(ForbiddenException);
    expect(chamou('')).toBe(false);
  });

  it('tabela ou condição inexistente (23503) vira 400 e faz rollback', async () => {
    const { controller, rodar, chamou } = montar({ falhaEm: { trecho: 'insert into tabela_preco_condicoes', code: '23503' } });
    await expect(rodar(() => controller.definirCondicoes(ADMIN, 'tab-1', { condicaoIds: ['c1'] } as never))).rejects.toBeInstanceOf(BadRequestException);
    expect(chamou('rollback')).toBe(true);
  });

  it('lista vazia só apaga, sem inserir', async () => {
    const { controller, rodar, chamou } = montar();
    const r = await rodar(() => controller.definirCondicoes(ADMIN, 'tab-1', { condicaoIds: [] } as never));
    expect(r).toEqual({ ok: true });
    expect(chamou('delete from tabela_preco_condicoes')).toBe(true);
    expect(chamou('insert into tabela_preco_condicoes')).toBe(false);
  });
});
