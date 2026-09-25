import type { Pool } from 'pg';
import type { TenantInfo } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';
import { DlinksPedidosService } from './dlinks-pedidos.service';

const tenant: TenantInfo = { id: 'uuid', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

describe('DlinksPedidosService.listar', () => {
  it('não lista pedidos aguardando pagamento e expõe pagamentoOnline', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', numero: 9, criado_em: new Date(), tipo_entrega: 'entrega', forma_pagamento: 'pix', condicao_pagamento: null,
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'PJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [],
        pagamento_online: { status: 'pago', pagoEm: '2026-09-25T14:32:00Z', txid: 'PED000009AAA', valor: 99.9 },
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-09-25', '2026-09-25'));
    expect(query.mock.calls[0][0]).toContain("p.status <> 'AGUARDANDO_PAGAMENTO'");
    expect(out.pedidos[0]).toEqual(expect.objectContaining({ pagamentoOnline: expect.objectContaining({ status: 'pago', txid: 'PED000009AAA' }) }));
  });
});
