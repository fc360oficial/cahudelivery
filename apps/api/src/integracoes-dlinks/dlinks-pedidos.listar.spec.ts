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
  it('não lista pedido retido do vendedor e expõe vendedor, tabela e condição', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p2', numero: 10, criado_em: new Date(), tipo_entrega: 'retirada', forma_pagamento: 'boleto', condicao_pagamento: 'BOLETO 14 DIAS',
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'CNPJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [], pagamento_online: null,
        vendedor_codigo: '6', vendedor_nome: 'Ana', tabela_codigo: '14', tabela_nome: 'Retirada boleto 14',
        condicao_codigo: '17', forma_codigo: '15',
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-11-09', '2026-11-09'));
    expect(query.mock.calls[0][0]).toContain("p.status <> 'AGUARDANDO_VENDEDOR'");
    expect(query.mock.calls[0][0]).toContain("p.retencao_json->>'confirmadoEm' is null");
    expect(out.pedidos[0]).toEqual(expect.objectContaining({
      vendedor: { codigo: '6', nome: 'Ana' },
      tabelaPreco: { codigo: '14', nome: 'Retirada boleto 14' },
      condicaoPagamentoCodigo: '17',
      formaPagamentoCodigo: '15',
    }));
  });

  it('pedido do app do cliente sai sem os campos do vendedor', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p3', numero: 11, criado_em: new Date(), tipo_entrega: 'entrega', forma_pagamento: 'pix', condicao_pagamento: null,
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'CNPJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [], pagamento_online: null,
        vendedor_codigo: null, vendedor_nome: null, tabela_codigo: null, tabela_nome: null, condicao_codigo: null, forma_codigo: null,
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-11-09', '2026-11-09'));
    expect(out.pedidos[0].vendedor).toBeUndefined();
    expect(out.pedidos[0].tabelaPreco).toBeUndefined();
  });
});
