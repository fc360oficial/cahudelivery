import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runComTenant } from '../tenancy/tenant-context';
import { VendasAuthService } from './vendas-auth.service';

const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU Distribuidora', appNome: 'CAHU', adaptadorErp: 'dlinks' };

function montar(vendedor: Record<string, unknown> | null) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from vendedores where login')) return { rows: vendedor ? [vendedor] : [], rowCount: vendedor ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const jwt = { signAsync: jest.fn(async () => 'token-de-acesso') };
  const limite = { conferir: jest.fn(), registrarFalha: jest.fn(), limpar: jest.fn() };
  const servico = new VendasAuthService(jwt as never, limite as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant, pool: { query } } as never, fn);
  return { servico, query, jwt, limite, rodar };
}

describe('VendasAuthService.login', () => {
  it('entra com login e senha corretos e emite token do tipo vendedor', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, jwt, query, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: true });
    const out = await rodar(() => servico.login(' ANA ', 'segredo123', '1.1.1.1'));
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' });
    expect(out.accessToken).toBe('token-de-acesso');
    expect(out.refreshToken.length).toBeGreaterThan(40);
    expect(out.vendedor).toEqual({ id: 'v1', nome: 'Ana' });
    const consulta = query.mock.calls.find(([sql]) => String(sql).includes('from vendedores where login'));
    expect(consulta![1]).toEqual(['ana']);
    const refresh = query.mock.calls.find(([sql]) => String(sql).includes('insert into refresh_tokens'));
    expect(String(refresh![0])).toContain("'vendedor'");
  });

  it('recusa senha errada e conta a falha', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, limite, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: true });
    await expect(rodar(() => servico.login('ana', 'errada', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limite.registrarFalha).toHaveBeenCalledWith(['vend:ana', 'ip:1.1.1.1']);
  });

  it('recusa vendedor desativado mesmo com a senha certa', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: false });
    await expect(rodar(() => servico.login('ana', 'segredo123', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa vendedor que ainda não tem senha definida', async () => {
    const { servico, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash: null, ativo: true });
    await expect(rodar(() => servico.login('ana', 'qualquer', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
