import { UnauthorizedException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { AuthService } from './auth.service';

describe('AuthService.refresh', () => {
  it("só renova refresh token de sujeito 'cliente' (token de vendedor não vale aqui)", async () => {
    const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
    const svc = new AuthService({} as never, {} as never);
    const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU', adaptadorErp: 'dlinks' };
    await expect(runComTenant({ tenant, pool: { query } } as never, () => svc.refresh('token'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain("sujeito = 'cliente'");
  });
});
