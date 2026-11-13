import { BadRequestException } from '@nestjs/common';
import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { OrdersService } from './orders.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

const ITEM = { produto_id: 'prod-1', quantidade: 2, nome: 'Item X', unidade_venda: 'un', qtd_minima: 1, estoque: 10, imagem_url: null, preco_atual: '10.00' };

/**
 * Banco falso com estado: um carrinho que esvazia no `delete` e uma trava
 * consultiva de verdade (a segunda transação espera a primeira terminar).
 * O carrinho só "esvazia" para os outros quando a transação faz commit,
 * como no Postgres em read committed.
 */
function bancoComTrava() {
  let carrinho: (typeof ITEM)[] = [ITEM];
  let pedidosInseridos = 0;
  let donoDaTrava: Promise<void> | null = null;

  const consultaComum = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('select status from clientes')) return { rows: [{ status: 'aprovado' }] };
    if (sql.includes('insert into carrinhos')) return { rows: [{ id: 'carrinho-1' }] };
    if (sql.includes('from carrinho_itens ci')) return { rows: [...carrinho] };
    if (sql.includes(`chave = 'formas_pagamento'`)) return { rows: [{ valor_json: ['pix', 'boleto'] }] };
    if (sql.includes('select limite_credito')) return { rows: [{ limite_credito: null }] };
    if (sql.includes('from cliente_enderecos')) return { rows: [{ id: 'end-1' }] };
    if (sql.includes('insert into pedidos')) {
      pedidosInseridos++;
      return { rows: [{ id: `ped-${pedidosInseridos}`, numero: 40 + pedidosInseridos, status: params[8], criado_em: new Date() }] };
    }
    return { rows: [], rowCount: 0 };
  };

  const pool = {
    query: jest.fn((sql: string, params?: unknown[]) => consultaComum(sql, params)),
    connect: async () => {
      let soltar: (() => void) | null = null;
      let esvaziarNoCommit = false;
      const terminar = () => {
        if (soltar) {
          soltar();
          soltar = null;
          donoDaTrava = null;
        }
      };
      return {
        release: jest.fn(),
        query: jest.fn(async (sql: string, params?: unknown[]) => {
          if (sql === 'begin') return { rows: [] };
          if (sql.includes('pg_advisory_xact_lock')) {
            while (donoDaTrava) await donoDaTrava;
            donoDaTrava = new Promise<void>((r) => (soltar = r));
            return { rows: [] };
          }
          if (sql.includes('delete from carrinho_itens')) {
            esvaziarNoCommit = true;
            return { rows: [], rowCount: carrinho.length };
          }
          if (sql === 'commit') {
            if (esvaziarNoCommit) carrinho = [];
            terminar();
            return { rows: [] };
          }
          if (sql === 'rollback') {
            terminar();
            return { rows: [] };
          }
          return consultaComum(sql, params);
        }),
      };
    },
  } as unknown as Pool;

  return { pool, pedidos: () => pedidosInseridos };
}

function servico() {
  const catalog = { tabelaPrecoDe: jest.fn().mockResolvedValue('tabela-1') } as unknown as CatalogService;
  return new OrdersService(catalog, {} as PagamentosService, { obter: jest.fn() } as unknown as ProvedoresService);
}

describe('OrdersService.criarPedido — duplo envio (carrinho lido depois da trava do cliente)', () => {
  const dto = { enderecoId: 'end-1', formaPagamento: 'boleto' as const };

  it('duas chamadas concorrentes: só a primeira insere pedido; a segunda recebe "Carrinho vazio"', async () => {
    const { pool, pedidos } = bancoComTrava();
    const svc = servico();
    const rodar = () => runComTenant({ tenant: TENANT as never, pool }, () => svc.criarPedido('cli-1', dto));

    const [a, b] = await Promise.allSettled([rodar(), rodar()]);

    expect(pedidos()).toBe(1);
    const ok = [a, b].filter((r) => r.status === 'fulfilled');
    const recusas = [a, b].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(recusas).toHaveLength(1);
    expect(recusas[0].reason).toBeInstanceOf(BadRequestException);
    expect((recusas[0].reason as Error).message).toBe('Carrinho vazio');
  });

  it('duas chamadas em sequência: a segunda recebe "Carrinho vazio" e não insere', async () => {
    const { pool, pedidos } = bancoComTrava();
    const svc = servico();
    const rodar = () => runComTenant({ tenant: TENANT as never, pool }, () => svc.criarPedido('cli-1', dto));

    await expect(rodar()).resolves.toMatchObject({ id: 'ped-1', numero: 41 });
    await expect(rodar()).rejects.toThrow('Carrinho vazio');
    expect(pedidos()).toBe(1);
  });
});
