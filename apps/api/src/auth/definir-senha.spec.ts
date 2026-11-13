import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runComTenant } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';

const TENANT = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU', adaptadorErp: 'dlinks' };
let HASH_ATUAL: string;
beforeAll(async () => {
  HASH_ATUAL = await argon2.hash('senha-antiga-123');
});

function montar(opts: { falharNoDelete?: boolean } = {}) {
  const linha: string[] = []; // ordem de tudo o que chega ao banco, pool e transação juntos
  const query = jest.fn(async (sql: string) => {
    linha.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
    if (sql.includes('from cliente_credenciais cc join clientes')) {
      return { rows: [{ senha_hash: HASH_ATUAL, senha_provisoria: false, documento: '12345678000199' }] };
    }
    if (opts.falharNoDelete && sql.includes('delete from refresh_tokens')) throw new Error('falha no banco');
    return { rows: [], rowCount: 1 };
  });
  const release = jest.fn();
  const pool = { query, connect: async () => ({ query, release }) };
  const jwt = { signAsync: jest.fn().mockResolvedValue('jwt-novo') };
  const svc = new AuthService(jwt as never, {} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT, pool } as never, fn);
  return { svc, query, linha, release, rodar };
}
const sqls = (q: jest.Mock) => q.mock.calls.map((c) => String((c as unknown[])[0]));

describe('AuthService.definirSenha — trocar a senha derruba as outras sessões', () => {
  it('troca a senha e apaga os refresh tokens do cliente na mesma transação, depois emite um par novo', async () => {
    const { svc, query, linha, release, rodar } = montar();
    const out = await rodar(() => svc.definirSenha('cli-1', 'senha-antiga-123', 'Nova$enha-forte-9'));

    expect(out).toEqual({ ok: true, accessToken: 'jwt-novo', refreshToken: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/) });
    const i = (prefixo: string) => linha.findIndex((s) => s.startsWith(prefixo));
    expect(i('begin')).toBeGreaterThan(-1);
    expect(i('update cliente_credenciais set')).toBeGreaterThan(i('begin'));
    expect(i('delete from refresh_tokens')).toBeGreaterThan(i('update cliente_credenciais set'));
    expect(i('commit')).toBeGreaterThan(i('delete from refresh_tokens'));
    // O token novo nasce depois do commit — não pode ser apagado junto com os antigos.
    expect(i('insert into refresh_tokens')).toBeGreaterThan(i('commit'));
    expect(release).toHaveBeenCalled();

    const del = query.mock.calls.find((c) => String(c[0]).includes('delete from refresh_tokens'))!;
    expect(String(del[0])).toContain("sujeito = 'cliente'");
    expect(del[1]).toEqual(['cli-1']);
    const upd = query.mock.calls.find((c) => String(c[0]).includes('update cliente_credenciais'))!;
    expect(await argon2.verify((upd[1] as string[])[1], 'Nova$enha-forte-9')).toBe(true);
  });

  it('senha atual errada: 401 e nada muda (nem senha nem sessões)', async () => {
    const { svc, query, rodar } = montar();
    await expect(rodar(() => svc.definirSenha('cli-1', 'errada', 'Nova$enha-forte-9'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sqls(query).some((s) => /update cliente_credenciais|refresh_tokens/.test(s))).toBe(false);
  });

  it('falha ao apagar as sessões: rollback, a senha antiga continua e nenhum token sai', async () => {
    const { svc, linha, release, rodar } = montar({ falharNoDelete: true });
    await expect(rodar(() => svc.definirSenha('cli-1', 'senha-antiga-123', 'Nova$enha-forte-9'))).rejects.toThrow('falha no banco');
    expect(linha).toContain('rollback');
    expect(linha).not.toContain('commit');
    expect(linha.some((s) => s.startsWith('insert into refresh_tokens'))).toBe(false);
    expect(release).toHaveBeenCalled();
  });
});
