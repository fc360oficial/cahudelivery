import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OptionalAuthGuard } from './jwt.guard';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Bug real (17/09/2026): cliente logado, access token vencido (15 min), adiciona
 * 3 itens ao carrinho → OptionalAuthGuard tratava o token vencido como
 * "visitante" e os itens iam pro carrinho do X-Device-Id. No "Confirmar pedido"
 * (JwtAuthGuard) o app renovava o token e o carrinho do cliente estava vazio.
 * Token presente e inválido tem que dar 401 pro app renovar e repetir.
 */
describe('OptionalAuthGuard', () => {
  const jwt = new JwtService({ secret: 'teste' });
  const guard = new OptionalAuthGuard(jwt);
  const tenant = { tenant: { slug: 'cahu' } as any, pool: {} as any };

  function ctxCom(authorization?: string) {
    const req: any = { headers: authorization ? { authorization } : {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    return { req, ctx };
  }

  it('sem Authorization: segue como visitante', async () => {
    const { req, ctx } = ctxCom();
    await expect(runComTenant(tenant, () => guard.canActivate(ctx))).resolves.toBe(true);
    expect(req.cliente).toBeUndefined();
  });

  it('token válido do tenant: anexa req.cliente', async () => {
    const token = await jwt.signAsync({ sub: 'cli-1', slug: 'cahu', tipo: 'cliente' });
    const { req, ctx } = ctxCom(`Bearer ${token}`);
    await runComTenant(tenant, () => guard.canActivate(ctx));
    expect(req.cliente).toEqual({ clienteId: 'cli-1' });
  });

  it('token VENCIDO: responde 401 (não rebaixa pra visitante)', async () => {
    const token = await jwt.signAsync({ sub: 'cli-1', slug: 'cahu', tipo: 'cliente' }, { expiresIn: '-1s' });
    const { ctx } = ctxCom(`Bearer ${token}`);
    await expect(runComTenant(tenant, () => guard.canActivate(ctx))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('token de outro tenant: responde 401', async () => {
    const token = await jwt.signAsync({ sub: 'cli-1', slug: 'outra', tipo: 'cliente' });
    const { ctx } = ctxCom(`Bearer ${token}`);
    await expect(runComTenant(tenant, () => guard.canActivate(ctx))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
