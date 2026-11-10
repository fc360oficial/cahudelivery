import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminAuthController } from './admin-auth.controller';
import { AdminConfigController, UsuarioDto } from './admin-config.controller';
import { AdminGuard } from './admin.guard';

jest.mock('argon2', () => ({
  verify: jest.fn(async () => true),
  hash: jest.fn(async () => 'hash'),
}));

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU' };
const rodar = <T>(query: jest.Mock, fn: () => Promise<T>) =>
  runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);

const SEM_ACESSO = {
  statusCode: 403,
  message: 'Sem acesso a esta solução',
  codigo: 'SEM_ACESSO_A_SOLUCAO',
};

async function passa(payload: Record<string, unknown>, url: string) {
  const jwt = {
    verifyAsync: jest.fn(async () => ({
      sub: 'u1',
      slug: 'cahu',
      tipo: 'admin',
      ...payload,
    })),
  };
  const guard = new AdminGuard(jwt as never);
  const req: Record<string, unknown> = {
    headers: { authorization: 'Bearer x' },
    originalUrl: url,
    url,
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
  try {
    await rodar(jest.fn(), async () => guard.canActivate(ctx as never));
    return { ok: true as const, req };
  } catch (e) {
    return { ok: false as const, erro: e as ForbiddenException, req };
  }
}

describe('AdminGuard — acesso por solução', () => {
  it('admin acessa Vendas e Delivery', async () => {
    expect(
      (await passa({ papel: 'admin' }, '/v1/admin/vendas/painel')).ok,
    ).toBe(true);
    expect((await passa({ papel: 'admin' }, '/v1/admin/pedidos')).ok).toBe(
      true,
    );
  });
  it('admin sempre tem as duas, mesmo com claim menor', async () => {
    const r = await passa(
      { papel: 'admin', solucoes: ['delivery'] },
      '/v1/admin/vendas/x',
    );
    expect(r.ok).toBe(true);
    expect((r.req as { admin: { solucoes: string[] } }).admin.solucoes).toEqual(
      ['delivery', 'vendas'],
    );
  });
  it("operador só 'delivery': recusado em Vendas, passa no Delivery", async () => {
    const r = await passa(
      { papel: 'operador', solucoes: ['delivery'] },
      '/v1/admin/vendas/x',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toBeInstanceOf(ForbiddenException);
      expect(r.erro.getResponse()).toEqual(SEM_ACESSO);
    }
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['delivery'] },
          '/v1/admin/pedidos',
        )
      ).ok,
    ).toBe(true);
  });
  it("operador só 'vendas': passa em Vendas, recusado no Delivery", async () => {
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['vendas'] },
          '/v1/admin/vendas/x',
        )
      ).ok,
    ).toBe(true);
    const r = await passa(
      { papel: 'operador', solucoes: ['vendas'] },
      '/v1/admin/pedidos',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro.getResponse()).toEqual(SEM_ACESSO);
  });
  it("token sem claim 'solucoes' vale ['delivery']", async () => {
    const r = await passa({ papel: 'operador' }, '/v1/admin/pedidos');
    expect(r.ok).toBe(true);
    expect((r.req as { admin: { solucoes: string[] } }).admin.solucoes).toEqual(
      ['delivery'],
    );
    expect((await passa({ papel: 'operador' }, '/v1/admin/vendas/x')).ok).toBe(
      false,
    );
  });
  it.each([
    '/v1/admin/auth/login',
    '/v1/admin/usuarios',
    '/v1/admin/usuarios/abc',
    '/v1/admin/logs/integracao?pagina=2',
  ])('rota isenta %s passa para operador só com vendas', async (url) => {
    expect(
      (await passa({ papel: 'operador', solucoes: ['vendas'] }, url)).ok,
    ).toBe(true);
  });
  it('rota com query string é classificada pelo caminho', async () => {
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['delivery'] },
          '/v1/admin/pedidos?x=/v1/admin/vendas',
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['delivery'] },
          '/v1/admin/vendas/x?y=1',
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['vendas'] },
          '/v1/admin/pedidos?x=/v1/admin/vendas',
        )
      ).ok,
    ).toBe(false);
  });
  it('caminho é comparado sem diferenciar maiúsculas nem barra final', async () => {
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['delivery'] },
          '/V1/Admin/VENDAS/x',
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await passa(
          { papel: 'operador', solucoes: ['delivery'] },
          '/v1/admin/vendas/',
        )
      ).ok,
    ).toBe(false);
  });
});

describe('login da retaguarda — solucoes', () => {
  async function logar(papel: string, solucoes: string[]) {
    const jwt = { signAsync: jest.fn(async () => 'tok') };
    const limite = {
      conferir: jest.fn(),
      registrarFalha: jest.fn(),
      limpar: jest.fn(),
    };
    const ctl = new AdminAuthController(jwt as never, limite as never);
    const query = jest.fn(async () => ({
      rows: [
        {
          id: 'u1',
          nome: 'Ana',
          papel,
          senha_hash: 'h',
          ativo: true,
          solucoes,
        },
      ],
    }));
    const res = await rodar(query, () =>
      ctl.login(
        { headers: {}, socket: { remoteAddress: '1.1.1.1' } } as never,
        { email: 'a@b.com', senha: 'x' },
      ),
    );
    return { res, jwt, sql: String((query.mock.calls[0] as unknown[])[0]) };
  }
  it('operador: resposta e token trazem a lista do banco', async () => {
    const { res, jwt, sql } = await logar('operador', ['vendas']);
    expect(sql).toContain('solucoes');
    expect(res.solucoes).toEqual(['vendas']);
    expect((jwt.signAsync.mock.calls[0] as unknown[])[0]).toMatchObject({
      papel: 'operador',
      solucoes: ['vendas'],
    });
  });
  it('admin sempre recebe as duas', async () => {
    const { res, jwt } = await logar('admin', ['delivery']);
    expect(res.solucoes).toEqual(['delivery', 'vendas']);
    expect((jwt.signAsync.mock.calls[0] as unknown[])[0]).toMatchObject({
      solucoes: ['delivery', 'vendas'],
    });
  });
});

describe('usuários da retaguarda — solucoes', () => {
  const base = {
    nome: 'Ana',
    email: 'a@b.com',
    senha: 'senha1234',
    papel: 'operador',
  };
  const erros = async (extra: Record<string, unknown>) =>
    validate(plainToInstance(UsuarioDto, { ...base, ...extra }), {
      whitelist: true,
    });
  const ID = '11111111-1111-4111-8111-111111111111';

  it('valor inválido é rejeitado', async () => {
    expect((await erros({ solucoes: ['financeiro'] })).length).toBeGreaterThan(
      0,
    );
  });
  it('repetido é rejeitado', async () => {
    expect(
      (await erros({ solucoes: ['vendas', 'vendas'] })).length,
    ).toBeGreaterThan(0);
  });
  it('lista válida e omitida passam na validação', async () => {
    expect(await erros({ solucoes: ['delivery', 'vendas'] })).toHaveLength(0);
    expect(await erros({})).toHaveLength(0);
  });

  const ctl = new AdminConfigController();
  const reqAdmin = { admin: { usuarioId: 'a', papel: 'admin' } } as never;
  it('operador com lista vazia é rejeitado ao criar e ao editar', async () => {
    const dto = plainToInstance(UsuarioDto, { ...base, solucoes: [] });
    const q = jest.fn(async () => ({ rows: [{}] }));
    await expect(
      rodar(q, () => ctl.criarUsuario(reqAdmin, dto)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      rodar(q, () => ctl.editarUsuario(reqAdmin, ID, dto)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(q).not.toHaveBeenCalled();
  });
  it('criar grava solucoes; admin grava as duas', async () => {
    const q = jest.fn(async () => ({ rows: [{ id: 'n' }] }));
    await rodar(q, () =>
      ctl.criarUsuario(
        reqAdmin,
        plainToInstance(UsuarioDto, { ...base, solucoes: ['vendas'] }),
      ),
    );
    expect((q.mock.calls[0] as unknown[][])[1]).toContainEqual(['vendas']);
    const q2 = jest.fn(async () => ({ rows: [{ id: 'n' }] }));
    await rodar(q2, () =>
      ctl.criarUsuario(
        reqAdmin,
        plainToInstance(UsuarioDto, {
          ...base,
          papel: 'admin',
          solucoes: ['delivery'],
        }),
      ),
    );
    expect((q2.mock.calls[0] as unknown[][])[1]).toContainEqual([
      'delivery',
      'vendas',
    ]);
  });
  it('editar sem solucoes não altera a lista de operador', async () => {
    const q = jest.fn(async () => ({ rows: [{ id: 'n' }] }));
    await rodar(q, () =>
      ctl.editarUsuario(reqAdmin, ID, plainToInstance(UsuarioDto, base)),
    );
    const [sql, params] = q.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('coalesce($6, solucoes)');
    expect(params[5]).toBeNull();
  });
  it('editar para admin grava as duas', async () => {
    const q = jest.fn(async () => ({ rows: [{ id: 'n' }] }));
    await rodar(q, () =>
      ctl.editarUsuario(
        reqAdmin,
        ID,
        plainToInstance(UsuarioDto, { ...base, papel: 'admin' }),
      ),
    );
    expect((q.mock.calls[0] as unknown[][])[1]).toContainEqual([
      'delivery',
      'vendas',
    ]);
  });
  it('a listagem devolve solucoes', async () => {
    const q = jest.fn(async () => ({ rows: [] }));
    await rodar(q, () => ctl.usuarios());
    expect(String((q.mock.calls[0] as unknown[])[0])).toContain('solucoes');
  });
});
