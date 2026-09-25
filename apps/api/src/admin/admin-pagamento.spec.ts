import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { AdminService } from './admin.service';
import type { PagamentosService } from '../pagamentos/pagamentos.service';
import type { ProvedoresService } from '../pagamentos/provedores.service';
import { runComTenant } from '../tenancy/tenant-context';
import type { TenantInfo } from '../database/database.service';

const tenant: TenantInfo = { id: 'uuid', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

describe('AdminService — pagamento', () => {
  it('simularPagamento recusa quando o provedor do tenant não é o mock', async () => {
    const provedores = {
      obter: jest.fn(async () => ({ provedor: { nome: 'itau_pix' }, expiracaoSegundos: 1800 })),
    } as unknown as ProvedoresService;
    const pagamentos = {} as PagamentosService;
    const pool = { query: jest.fn() } as unknown as Pool;
    const service = new AdminService(provedores, pagamentos);

    await expect(runComTenant({ tenant, pool }, () => service.simularPagamento('ped-1'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('consultarPagamento devolve o status já pago sem chamar o provedor', async () => {
    const consultar = jest.fn();
    const provedores = {
      obter: jest.fn(async () => ({ provedor: { nome: 'itau_pix', consultar }, expiracaoSegundos: 1800 })),
    } as unknown as ProvedoresService;
    const pagamentos = { aplicarSituacao: jest.fn() } as unknown as PagamentosService;
    const query = jest.fn(async () => ({ rows: [{ id: 'pag-1', provedor_ref: 'REF1', expira_em: new Date(), status: 'pago' }] }));
    const pool = { query } as unknown as Pool;
    const service = new AdminService(provedores, pagamentos);

    const out = await runComTenant({ tenant, pool }, () => service.consultarPagamento('ped-1'));

    expect(out).toEqual({ status: 'pago' });
    expect(consultar).not.toHaveBeenCalled();
    expect(pagamentos.aplicarSituacao).not.toHaveBeenCalled();
  });
});
