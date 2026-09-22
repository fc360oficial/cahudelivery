import { MaxipagoService } from './maxipago.service';
import { runComTenant } from '../tenancy/tenant-context';
import type { Pool } from 'pg';
import type { TenantInfo } from '../database/database.service';

const tenant: TenantInfo = { id: 'uuid', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function contexto() {
  const query = jest.fn(async () => ({ rows: [{ id: 'webhook-uuid' }] }));
  return { pool: { query } as unknown as Pool, query };
}

describe('MaxipagoService', () => {
  it('grava o corpo cru com content-type e IP de origem', async () => {
    const { pool, query } = contexto();
    const service = new MaxipagoService();
    const xml = '<transaction-response><responseCode>0</responseCode></transaction-response>';
    const out = await runComTenant({ tenant, pool }, () => service.registrar(xml, 'text/xml', '200.200.1.1'));
    expect(out).toEqual({ recebido: true });
    expect(query.mock.calls[0][1]).toEqual(['text/xml', xml, '200.200.1.1']);
  });

  it('aceita callback sem content-type e sem IP', async () => {
    const { pool, query } = contexto();
    const service = new MaxipagoService();
    await runComTenant({ tenant, pool }, () => service.registrar('qualquer coisa'));
    expect(query.mock.calls[0][1]).toEqual([null, 'qualquer coisa', null]);
  });
});
