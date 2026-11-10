import { UnauthorizedException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { VendedorGuard } from './vendedor.guard';

const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU', adaptadorErp: 'dlinks' };

function contexto(authorization?: string) {
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never };
}

function rodar(payload: unknown, ativo: boolean, authorization = 'Bearer abc') {
  const jwt = { verifyAsync: jest.fn(async () => { if (!payload) throw new Error('inválido'); return payload; }) };
  const query = jest.fn(async () => ({ rows: ativo ? [{ ok: 1 }] : [], rowCount: ativo ? 1 : 0 }));
  const { req, ctx } = contexto(authorization);
  const guard = new VendedorGuard(jwt as never);
  return { req, promessa: runComTenant({ tenant, pool: { query } } as never, () => guard.canActivate(ctx)) };
}

describe('VendedorGuard', () => {
  it('aceita token de vendedor ativo do mesmo tenant e anexa req.vendedor', async () => {
    const { req, promessa } = rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, true);
    await expect(promessa).resolves.toBe(true);
    expect(req.vendedor).toEqual({ vendedorId: 'v1' });
  });

  it('consulta exige vendedor ativo e não bloqueado na retaguarda', async () => {
    const jwt = { verifyAsync: jest.fn(async () => ({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' })) };
    const query = jest.fn(async () => ({ rows: [{ ok: 1 }], rowCount: 1 }));
    const { ctx } = contexto('Bearer abc');
    await runComTenant({ tenant, pool: { query } } as never, () => new VendedorGuard(jwt as never).canActivate(ctx));
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain('not acesso_bloqueado');
  });

  it('recusa token de cliente', async () => {
    await expect(rodar({ sub: 'c1', slug: 'cahu', tipo: 'cliente' }, true).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token de outro tenant', async () => {
    await expect(rodar({ sub: 'v1', slug: 'outra', tipo: 'vendedor' }, true).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa vendedor desativado', async () => {
    await expect(rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, false).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa requisição sem Authorization', async () => {
    await expect(rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, true, '').promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
