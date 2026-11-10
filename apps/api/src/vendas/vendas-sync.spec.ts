import { runComTenant } from '../tenancy/tenant-context';
import { VendasSyncService } from './vendas-sync.service';

describe('VendasSyncService.carga', () => {
  it('devolve só a carteira do vendedor, converte números e registra a sincronização', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from vendedores where id')) return { rows: [{ id: 'v1', nome: 'Ana', erp_vendedor_id: '6' }] };
      if (sql.includes('/* clientes */')) {
        return { rows: [{ id: 'c1', erp_cliente_id: '10', documento: '123', razao_social: 'R', nome_fantasia: 'F', telefone: null,
          status: 'aprovado', limite_credito: '20000.00', em_aberto: '5700.00', endereco: { cidade: 'Recife' } }] };
      }
      if (sql.includes('/* precos */')) return { rows: [{ produto_id: 'p1', tabela_preco_id: 't1', preco: '86.40' }] };
      if (sql.includes('/* produtos */')) {
        return { rows: [{ id: 'p1', sku: '1', ean: '789', nome: 'Margarina', unidade_venda: 'CX', qtd_por_embalagem: '12.000',
          categoria_id: null, estoque: '186.000', imagem_url: null }] };
      }
      return { rows: [] };
    });
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasSyncService().carga('v1', '1.0.0'));

    const clientes = query.mock.calls.find(([sql]) => String(sql).includes('/* clientes */'));
    expect(String(clientes![0])).toContain('cv.vendedor_id = $1');
    expect(clientes![1]).toEqual(['v1']);
    expect(out.vendedor).toEqual({ id: 'v1', nome: 'Ana', erpVendedorId: '6' });
    expect(out.clientes[0]).toEqual(expect.objectContaining({ id: 'c1', limiteCredito: 20000, emAberto: 5700, endereco: { cidade: 'Recife' } }));
    expect(out.precos[0]).toEqual({ produtoId: 'p1', tabelaId: 't1', preco: 86.4 });
    expect(out.produtos[0]).toEqual(expect.objectContaining({ qtdPorEmbalagem: 12, estoque: 186 }));
    expect(typeof out.geradoEm).toBe('string');
    const registro = query.mock.calls.find(([sql]) => String(sql).includes('update vendedores set ultima_sync_em'));
    expect(registro![1]).toEqual(['v1', '1.0.0']);
  });

  it('mantém limite nulo quando o ERP ainda não enviou', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from vendedores where id')) return { rows: [{ id: 'v1', nome: 'Ana', erp_vendedor_id: '6' }] };
      if (sql.includes('/* clientes */')) {
        return { rows: [{ id: 'c1', erp_cliente_id: null, documento: '1', razao_social: null, nome_fantasia: 'F', telefone: null,
          status: 'aprovado', limite_credito: null, em_aberto: '0', endereco: null }] };
      }
      return { rows: [] };
    });
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasSyncService().carga('v1'));
    expect(out.clientes[0].limiteCredito).toBeNull();
  });
});
