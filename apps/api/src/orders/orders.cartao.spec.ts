import { BadRequestException, NotFoundException } from '@nestjs/common';
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

/** Mesmo padrão de orders.pix.spec.ts: pool falso casado por trecho de SQL. */
function fakePool(over: Record<string, any> = {}) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
    if (sql.includes('select pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
    if (sql.includes('select status from clientes')) return { rows: [{ status: 'ativo' }] };
    if (sql.includes('insert into carrinhos')) return { rows: [{ id: 'carrinho-1' }] };
    if (sql.includes('from carrinho_itens ci')) return { rows: [ITEM_CARRINHO] };
    if (sql.includes(`chave = 'pedido_minimo'`)) return { rows: [] };
    // Cartão só passa na validação quando está nas formas aceitas da retaguarda.
    if (sql.includes(`chave = 'formas_pagamento'`)) return { rows: [{ valor_json: ['pix', 'boleto', 'cartao'] }] };
    if (sql.includes('from cliente_enderecos')) return { rows: [{ id: 'end-1', rua: 'Rua X' }] };
    if (sql.includes('select coalesce(sum(valor),0) as saldo')) return { rows: [{ saldo: '0' }] };
    if (sql.includes('insert into pedidos')) {
      return { rows: [{ id: 'ped-1', numero: 42, status: (params as unknown[])[8], criado_em: new Date() }] };
    }
    if (sql.includes('insert into pedido_itens')) return { rows: [], rowCount: 1 };
    if (sql.includes('insert into pedido_eventos')) return { rows: [], rowCount: 1 };
    if (sql.includes('insert into sync_outbox')) return { rows: [], rowCount: 1 };
    if (sql.includes('delete from carrinho_itens')) return { rows: [], rowCount: 1 };
    if (sql.includes('from pagamentos g join pedidos p')) return over.pagamento ?? { rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}

function montarServico(pagamentos: Partial<PagamentosService>, provedores: Partial<ProvedoresService>) {
  const catalog = { tabelaPrecoDe: jest.fn().mockResolvedValue('tabela-1') } as unknown as CatalogService;
  return new OrdersService(catalog, pagamentos as PagamentosService, provedores as ProvedoresService);
}

const PROVEDOR_CARTAO = { nome: 'erede', metodo: 'cartao' as const };

describe('OrdersService.criarPedido — cartão online', () => {
  it('cartão com provedor: pedido nasce AGUARDANDO_PAGAMENTO com pagamento pendente, sem outbox', async () => {
    const { pool, query } = fakePool();
    const criarParaPedido = jest.fn().mockResolvedValue({
      id: 'pag-1', metodo: 'cartao', status: 'pendente', valor: 20, copiaCola: null, expiraEm: new Date(), pagoEm: null,
    });
    const obter = jest.fn().mockResolvedValue({ provedor: PROVEDOR_CARTAO, expiracaoSegundos: 1800 });
    const svc = montarServico({ criarParaPedido } as unknown as Partial<PagamentosService>, { obter } as unknown as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () =>
      svc.criarPedido('cli-1', { enderecoId: 'end-1', formaPagamento: 'cartao' }),
    );

    expect(obter).toHaveBeenCalledWith('cahu', 'cartao');
    expect(r.pagamento?.metodo).toBe('cartao');
    const insertPedido = query.mock.calls.find((c) => (c[0] as string).includes('insert into pedidos'));
    expect(insertPedido![1]).toEqual(expect.arrayContaining(['AGUARDANDO_PAGAMENTO']));
    const outbox = query.mock.calls.find((c) => (c[0] as string).includes('insert into sync_outbox'));
    expect(outbox).toBeUndefined();
  });

  it('cartão sem provedor: fluxo antigo (cartão na entrega) — RECEBIDO e na outbox', async () => {
    const { pool, query } = fakePool();
    const criarParaPedido = jest.fn();
    const obter = jest.fn().mockResolvedValue(null);
    const svc = montarServico({ criarParaPedido } as unknown as Partial<PagamentosService>, { obter } as unknown as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () =>
      svc.criarPedido('cli-1', { enderecoId: 'end-1', formaPagamento: 'cartao' }),
    );

    expect(r.pagamento).toBeNull();
    const insertPedido = query.mock.calls.find((c) => (c[0] as string).includes('insert into pedidos'));
    expect(insertPedido![1]).toEqual(expect.arrayContaining(['RECEBIDO']));
    expect(query.mock.calls.some((c) => (c[0] as string).includes('insert into sync_outbox'))).toBe(true);
    expect(criarParaPedido).not.toHaveBeenCalled();
  });

  it('provedor de cartão quebrado: não derruba o checkout, cai no fluxo antigo', async () => {
    const { pool, query } = fakePool();
    const obter = jest.fn().mockRejectedValue(new Error('credencial ausente'));
    const svc = montarServico({} as Partial<PagamentosService>, { obter } as unknown as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () =>
      svc.criarPedido('cli-1', { enderecoId: 'end-1', formaPagamento: 'cartao' }),
    );

    expect(r.pagamento).toBeNull();
    const insertPedido = query.mock.calls.find((c) => (c[0] as string).includes('insert into pedidos'));
    expect(insertPedido![1]).toEqual(expect.arrayContaining(['RECEBIDO']));
  });
});

describe('OrdersService.pagarCartao', () => {
  const CARTAO = { numero: '5448280000000007', nome: 'JOAO', validadeMes: 12, validadeAno: 2028, cvv: '123' };
  const LINHA = {
    id: 'pag-1', status: 'pendente', metodo: 'cartao', valor: '20.00',
    expira_em: new Date(Date.now() + 10 * 60 * 1000), provedor: 'erede', numero: 42,
  };

  it('cobra pelo provedor do pagamento e repassa o resultado', async () => {
    const { pool } = fakePool({ pagamento: { rows: [LINHA] } });
    const pagarComCartao = jest.fn().mockResolvedValue({ status: 'recusado', codigo: '111', mensagem: 'Sem limite' });
    const obterPorNome = jest.fn().mockResolvedValue({ provedor: PROVEDOR_CARTAO, expiracaoSegundos: 1800 });
    const svc = montarServico({ pagarComCartao } as unknown as Partial<PagamentosService>, { obterPorNome } as unknown as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () => svc.pagarCartao('cli-1', 'ped-1', CARTAO));

    expect(obterPorNome).toHaveBeenCalledWith('cahu', 'erede');
    expect(pagarComCartao).toHaveBeenCalledWith(
      pool,
      PROVEDOR_CARTAO,
      { id: 'pag-1', numero: 42, valor: 20, expira_em: LINHA.expira_em },
      CARTAO,
    );
    expect(r).toEqual({ status: 'recusado', codigo: '111', mensagem: 'Sem limite' });
  });

  it('pedido sem pagamento com cartão: 404', async () => {
    const { pool } = fakePool({ pagamento: { rows: [] } });
    const svc = montarServico({} as Partial<PagamentosService>, {} as Partial<ProvedoresService>);

    await expect(
      runComTenant({ tenant: TENANT as any, pool }, () => svc.pagarCartao('cli-1', 'ped-1', CARTAO)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pagamento já pago: devolve pago sem cobrar de novo', async () => {
    const { pool } = fakePool({ pagamento: { rows: [{ ...LINHA, status: 'pago' }] } });
    const pagarComCartao = jest.fn();
    const svc = montarServico({ pagarComCartao } as unknown as Partial<PagamentosService>, {} as Partial<ProvedoresService>);

    const r = await runComTenant({ tenant: TENANT as any, pool }, () => svc.pagarCartao('cli-1', 'ped-1', CARTAO));

    expect(r).toEqual({ status: 'pago' });
    expect(pagarComCartao).not.toHaveBeenCalled();
  });

  it('pagamento expirado: 400 com orientação de refazer o pedido', async () => {
    const { pool } = fakePool({ pagamento: { rows: [{ ...LINHA, status: 'expirado' }] } });
    const svc = montarServico({} as Partial<PagamentosService>, {} as Partial<ProvedoresService>);

    await expect(
      runComTenant({ tenant: TENANT as any, pool }, () => svc.pagarCartao('cli-1', 'ped-1', CARTAO)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
