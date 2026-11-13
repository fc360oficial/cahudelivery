import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';
import { DatabaseService } from '../database/database.service';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { OrdersService } from './orders.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

const ITEM = { produto_id: 'prod-1', quantidade: 2, nome: 'Item X', unidade_venda: 'un', qtd_minima: 1, estoque: 10, imagem_url: null, preco_atual: '10.00' };

/** Respostas do banco falso, casadas por trecho de SQL (mesmo padrão de orders.cartao.spec.ts). */
async function responder(sql: string, params: unknown[] = [], semEndereco = false) {
  if (semEndereco && sql.includes('from cliente_enderecos')) return { rows: [] };
  if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
  if (sql.includes('select pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
  if (sql.includes('select status from clientes')) return { rows: [{ status: 'ativo' }] };
  if (sql.includes('select tabela_preco_id from clientes')) return { rows: [{ tabela_preco_id: null }] };
  if (sql.includes('select id from tabelas_preco where padrao')) return { rows: [{ id: 'tabela-1' }] };
  if (sql.includes('insert into carrinhos')) return { rows: [{ id: 'carrinho-1' }] };
  if (sql.includes('from carrinho_itens ci')) return { rows: [ITEM] };
  if (sql.includes(`chave = 'pedido_minimo'`)) return { rows: [{ valor_json: { valor: 5 } }] };
  if (sql.includes(`chave = 'formas_pagamento'`)) return { rows: [{ valor_json: ['pix', 'boleto', 'cartao'] }] };
  if (sql.includes(`'cartao_valor_maximo','cartao_pedidos_anteriores'`)) {
    return {
      rows: [
        { chave: 'cartao_valor_maximo', valor_json: { valor: 1000 } },
        { chave: 'cartao_pedidos_anteriores', valor_json: { valor: 1 } },
      ],
    };
  }
  if (sql.includes('as n from pedidos where cliente_id')) return { rows: [{ n: 3 }] };
  if (sql.includes('select limite_credito')) return { rows: [{ limite_credito: '500.00' }] };
  if (sql.includes('from titulos_cliente')) return { rows: [{ total: '100.00' }] };
  if (sql.includes('from cliente_enderecos')) return { rows: [{ id: 'end-1', logradouro: 'Rua X' }] };
  if (sql.includes('select coalesce(sum(valor),0) as saldo')) return { rows: [{ saldo: '5.00' }] };
  if (sql.includes(`chave = 'politica_cancelamento'`)) return { rows: [{ valor_json: { texto: 'política' } }] };
  if (sql.includes('insert into pedidos')) return { rows: [{ id: 'ped-1', numero: 42, status: params[8], criado_em: new Date() }] };
  return { rows: [], rowCount: 1 };
}

/**
 * Pool falso que sabe quando a conexão da transação está emprestada. Toda
 * consulta feita no pool nesse intervalo precisaria de uma SEGUNDA conexão do
 * mesmo pool — é o que travava o pool inteiro com ~10 pedidos simultâneos.
 */
function poolVigiado(semEndereco = false) {
  let emprestada = false;
  const noPoolComClienteEmprestado: string[] = [];
  const noCliente: string[] = [];
  const release = jest.fn(() => {
    emprestada = false;
  });
  const pool = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      if (emprestada) noPoolComClienteEmprestado.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
      return responder(sql, params, semEndereco);
    }),
    connect: jest.fn(async () => {
      emprestada = true;
      return {
        release,
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          noCliente.push(sql);
          return responder(sql, params, semEndereco);
        }),
      };
    }),
  } as unknown as Pool;
  return { pool, noPoolComClienteEmprestado, noCliente, release };
}

/**
 * Pool falso de UMA conexão, com fila como o node-postgres: quem pede conexão
 * (connect ou query) com ela emprestada espera a devolução. Com o defeito, o
 * pedido espera a si mesmo para sempre.
 */
function poolDeUmaConexao() {
  let livre = true;
  const fila: Array<() => void> = [];
  const pegar = () =>
    new Promise<void>((ok) => {
      if (livre) {
        livre = false;
        ok();
      } else fila.push(ok);
    });
  const devolver = () => {
    const proximo = fila.shift();
    if (proximo) proximo();
    else livre = true;
  };
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      await pegar();
      try {
        return await responder(sql, params);
      } finally {
        devolver();
      }
    },
    connect: async () => {
      await pegar();
      return { release: devolver, query: (sql: string, params?: unknown[]) => responder(sql, params) };
    },
  } as unknown as Pool;
  return { pool };
}

function servico() {
  // CatalogService de verdade: a tabelaPrecoDe também precisa rodar na conexão da transação.
  const catalog = new CatalogService({} as DatabaseService);
  const pagamentos = {
    criarParaPedido: jest.fn().mockResolvedValue({
      id: 'pag-1', metodo: 'pix', status: 'pendente', valor: 15, copiaCola: 'x', expiraEm: new Date(), pagoEm: null,
    }),
  } as unknown as PagamentosService;
  const provedores = {
    obter: jest.fn(async (_slug: string, metodo: 'pix' | 'cartao') => ({
      provedor: { nome: metodo === 'pix' ? 'mock' : 'erede', metodo },
      expiracaoSegundos: 1800,
    })),
  } as unknown as ProvedoresService;
  return new OrdersService(catalog, pagamentos, provedores);
}

const CASOS = [
  { nome: 'boleto com entrega e limite de crédito', dto: { enderecoId: 'end-1', formaPagamento: 'boleto' as const } },
  { nome: 'cartão com regras de risco', dto: { enderecoId: 'end-1', formaPagamento: 'cartao' as const } },
  { nome: 'PIX usando saldo', dto: { enderecoId: 'end-1', formaPagamento: 'pix' as const, usarSaldo: true } },
];

describe('OrdersService.criarPedido — uma conexão só enquanto a transação está aberta', () => {
  it.each(CASOS)('$nome: nenhuma consulta no pool entre pegar e devolver a conexão', async ({ dto }) => {
    const { pool, noPoolComClienteEmprestado, noCliente, release } = poolVigiado();
    const r = await runComTenant({ tenant: TENANT as never, pool }, () => servico().criarPedido('cli-1', dto));

    expect(r).toMatchObject({ id: 'ped-1', numero: 42 });
    expect(noPoolComClienteEmprestado).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
    // A leitura do carrinho acontece na transação, depois da trava do cliente.
    const trava = noCliente.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const leitura = noCliente.findIndex((s) => s.includes('from carrinho_itens ci'));
    expect(trava).toBeGreaterThan(-1);
    expect(leitura).toBeGreaterThan(trava);
  });

  it('recusa de validação também não usa o pool com a conexão emprestada, e devolve a conexão', async () => {
    const { pool, noPoolComClienteEmprestado, release } = poolVigiado(true);
    const dto = { enderecoId: 'end-inexistente', formaPagamento: 'boleto' as const };
    await expect(
      runComTenant({ tenant: TENANT as never, pool }, () => servico().criarPedido('cli-1', dto)),
    ).rejects.toThrow('Endereço inválido');
    expect(noPoolComClienteEmprestado).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(CASOS)('$nome: termina num pool de uma conexão só (antes ficava esperando a si mesmo)', async ({ dto }) => {
    const { pool } = poolDeUmaConexao();
    const pedido = runComTenant({ tenant: TENANT as never, pool }, () => servico().criarPedido('cli-1', dto));
    let timer: NodeJS.Timeout | undefined;
    const travou = new Promise<'travou'>((ok) => {
      timer = setTimeout(() => ok('travou'), 1000);
    });
    const r = await Promise.race([pedido, travou]);
    clearTimeout(timer);
    expect(r).not.toBe('travou');
    expect(r).toMatchObject({ id: 'ped-1' });
  });
});
