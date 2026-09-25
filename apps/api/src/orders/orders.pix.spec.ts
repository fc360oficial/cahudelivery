import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { OrdersService } from './orders.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

const ITEM_CARRINHO = {
  produto_id: 'prod-1',
  quantidade: 2,
  nome: 'Item X',
  unidade_venda: 'un',
  qtd_minima: 1,
  estoque: 10,
  imagem_url: null,
  preco_atual: '10.00',
};

/**
 * Pool falso casado por trecho do SQL (não por posição): criarPedido tem muitas queries e
 * qualquer reordenação inofensiva no meio quebraria um fake posicional. release/connect
 * seguem o mesmo padrão de pagamentos.service.spec.ts.
 */
function fakePool() {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
    if (sql.includes('select pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('select status from clientes')) return { rows: [{ status: 'ativo' }] };
    if (sql.includes('insert into carrinhos')) return { rows: [{ id: 'carrinho-1' }] };
    if (sql.includes('from carrinho_itens ci')) return { rows: [ITEM_CARRINHO] };
    if (sql.includes(`chave = 'pedido_minimo'`)) return { rows: [] };
    if (sql.includes(`chave = 'formas_pagamento'`)) return { rows: [] };
    if (sql.includes('from cliente_enderecos')) return { rows: [{ id: 'end-1', rua: 'Rua X' }] };
    if (sql.includes('select coalesce(sum(valor),0) as saldo')) return { rows: [{ saldo: '0' }] };
    if (sql.includes('insert into pedidos')) {
      return { rows: [{ id: 'ped-1', numero: 42, status: (params as unknown[])[8], criado_em: new Date() }] };
    }
    if (sql.includes('insert into pedido_itens')) return { rows: [], rowCount: 1 };
    if (sql.includes('insert into pedido_eventos')) return { rows: [], rowCount: 1 };
    if (sql.includes('insert into sync_outbox')) return { rows: [], rowCount: 1 };
    if (sql.includes('delete from carrinho_itens')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}

function montarServico(pagamentos: Partial<PagamentosService>, provedores: Partial<ProvedoresService>) {
  const catalog = { tabelaPrecoDe: jest.fn().mockResolvedValue('tabela-1') } as unknown as CatalogService;
  return new OrdersService(catalog, pagamentos as PagamentosService, provedores as ProvedoresService);
}

describe('OrdersService.criarPedido — PIX online', () => {
  it('PIX com provedor: pedido nasce AGUARDANDO_PAGAMENTO, cria cobrança com o client da transação, sem entrar na outbox', async () => {
    const { pool, query } = fakePool();
    const criarParaPedido = jest.fn().mockResolvedValue({
      id: 'pag-1', metodo: 'pix', status: 'pendente', valor: 20, copiaCola: 'MOCKPIX-X', expiraEm: new Date(), pagoEm: null,
    });
    const obter = jest.fn().mockResolvedValue({ provedor: { nome: 'mock', metodo: 'pix' }, expiracaoSegundos: 1800 });
    const svc = montarServico({ criarParaPedido } as unknown as Partial<PagamentosService>, { obter } as unknown as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () =>
      svc.criarPedido('cli-1', { enderecoId: 'end-1', formaPagamento: 'pix' }),
    );

    expect(r.pagamento?.id).toBe('pag-1');
    const insertPedido = query.mock.calls.find((c) => (c[0] as string).includes('insert into pedidos'));
    expect(insertPedido![1]).toEqual(expect.arrayContaining(['AGUARDANDO_PAGAMENTO']));
    expect(criarParaPedido).toHaveBeenCalledTimes(1);
    // client, não pool: mesmo objeto `query` que as outras queries da transação usaram.
    const clientePassado = criarParaPedido.mock.calls[0][0];
    expect(clientePassado.query).toBe(query);
    const outbox = query.mock.calls.find((c) => (c[0] as string).includes('insert into sync_outbox'));
    expect(outbox).toBeUndefined();
    expect(query.mock.calls.map((c) => c[0])).toContain('commit');
  });

  it('criarParaPedido rejeita: dá rollback, não commita, e o erro vira BadRequestException', async () => {
    const { pool, query } = fakePool();
    const criarParaPedido = jest.fn().mockRejectedValue(new Error('Itaú fora do ar'));
    const obter = jest.fn().mockResolvedValue({ provedor: { nome: 'itau_pix', metodo: 'pix' }, expiracaoSegundos: 1800 });
    const svc = montarServico({ criarParaPedido } as unknown as Partial<PagamentosService>, { obter } as unknown as Partial<ProvedoresService>);

    await expect(
      runComTenant({ tenant: TENANT as any, pool }, () => svc.criarPedido('cli-1', { enderecoId: 'end-1', formaPagamento: 'pix' })),
    ).rejects.toBeInstanceOf(BadRequestException);

    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
  });
});
