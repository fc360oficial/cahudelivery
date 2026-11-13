import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { DlinksPedidosService } from '../integracoes-dlinks/dlinks-pedidos.service';
import { VendasSyncService } from '../vendas/vendas-sync.service';
import { MapaService } from '../admin/mapa.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { origemDoCanal, origemParaContrato } from './origem-pedido';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

describe('origemDoCanal — cabeçalho X-Canal', () => {
  it("só o valor exato 'site' vira origem site", () => {
    expect(origemDoCanal('site')).toBe('site');
  });
  it('ausente, vazio ou qualquer outro valor: app_cliente, sem erro', () => {
    for (const v of [undefined, null, '', ' site', 'site ', 'SITE', 'Site', 'app', 'vendedor', 'outro', ['site'], 1]) {
      expect(origemDoCanal(v)).toBe('app_cliente');
    }
  });
});

describe('origemParaContrato — ERP e app do vendedor só conhecem app_cliente | vendedor', () => {
  it('site sai como app_cliente; os outros valores passam iguais', () => {
    expect(origemParaContrato('site')).toBe('app_cliente');
    expect(origemParaContrato('app_cliente')).toBe('app_cliente');
    expect(origemParaContrato('vendedor')).toBe('vendedor');
  });
});

const ITEM = { produto_id: 'prod-1', quantidade: 2, nome: 'Item X', unidade_venda: 'un', qtd_minima: 1, estoque: 10, imagem_url: null, preco_atual: '10.00' };

function fakePool() {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('select status from clientes')) return { rows: [{ status: 'aprovado' }] };
    if (sql.includes('insert into carrinhos')) return { rows: [{ id: 'carrinho-1' }] };
    if (sql.includes('from carrinho_itens ci')) return { rows: [ITEM] };
    if (sql.includes(`chave = 'formas_pagamento'`)) return { rows: [{ valor_json: ['pix', 'boleto'] }] };
    if (sql.includes('select limite_credito')) return { rows: [{ limite_credito: null }] };
    if (sql.includes('from cliente_enderecos')) return { rows: [{ id: 'end-1' }] };
    if (sql.includes('insert into pedidos')) return { rows: [{ id: 'ped-1', numero: 42, status: params[8], criado_em: new Date() }] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: jest.fn() }) } as unknown as Pool;
  return { pool, query };
}

function servico() {
  const catalog = { tabelaPrecoDe: jest.fn().mockResolvedValue('tabela-1') } as unknown as CatalogService;
  return new OrdersService(catalog, {} as PagamentosService, { obter: jest.fn() } as unknown as ProvedoresService);
}

async function criar(canal?: 'app_cliente' | 'site') {
  const { pool, query } = fakePool();
  const svc = servico();
  const dto = { enderecoId: 'end-1', formaPagamento: 'boleto' as const };
  await runComTenant({ tenant: TENANT as never, pool }, () =>
    canal ? svc.criarPedido('cli-1', dto, { ip: null, userAgent: null }, canal) : svc.criarPedido('cli-1', dto),
  );
  const insert = query.mock.calls.find((c) => String(c[0]).includes('insert into pedidos'))!;
  return { query, insert: insert as unknown as [string, unknown[]] };
}

describe('OrdersService.criarPedido — origem', () => {
  it('sem canal grava app_cliente (comportamento de hoje)', async () => {
    const { insert } = await criar();
    expect(insert[0]).toMatch(/insert into pedidos \([^)]*\borigem\)/);
    expect(insert[1][insert[1].length - 1]).toBe('app_cliente');
  });

  it("com canal site grava origem 'site'", async () => {
    const { insert } = await criar('site');
    expect(insert[1][insert[1].length - 1]).toBe('site');
  });

  it('o canal não muda nenhuma regra: mesmas consultas, mesmos parâmetros, só a origem difere', async () => {
    const app = await criar();
    const site = await criar('site');
    const semData = (calls: unknown[][]) =>
      calls.map(([sql, params]) => [sql, (params as unknown[] | undefined)?.map((p) => (typeof p === 'string' && p.includes('"em"') ? 'aceite' : p))]);
    const a = semData(app.query.mock.calls);
    const s = semData(site.query.mock.calls);
    expect(s.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      if (String(a[i][0]).includes('insert into pedidos')) {
        expect((s[i][1] as unknown[]).slice(0, -1)).toEqual((a[i][1] as unknown[]).slice(0, -1));
      } else {
        expect(s[i]).toEqual(a[i]);
      }
    }
  });
});

describe('OrdersController.criar — cabeçalho X-Canal', () => {
  const req = { cliente: { clienteId: 'cli-1' }, headers: {}, socket: {} } as never;
  const dto = { enderecoId: 'end-1', formaPagamento: 'pix' } as never;
  it.each([
    [undefined, 'app_cliente'],
    ['', 'app_cliente'],
    ['outro', 'app_cliente'],
    ['SITE', 'app_cliente'],
    ['site', 'site'],
  ])('X-Canal=%p => origem %s', async (canal, esperado) => {
    const criarPedido = jest.fn().mockResolvedValue({});
    const ctl = new OrdersController({ criarPedido } as unknown as OrdersService);
    await ctl.criar(req, dto, canal as string | undefined);
    expect(criarPedido).toHaveBeenCalledWith('cli-1', dto, expect.anything(), esperado);
  });
});

describe('Pedido do site se comporta como app_cliente nos contratos externos', () => {
  it('Dlinks recebe origem app_cliente para pedido do site', async () => {
    const base = {
      numero: 11, criado_em: new Date(), tipo_entrega: 'entrega', forma_pagamento: 'pix', condicao_pagamento: null,
      endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'PJ',
      razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [], pagamento_online: null,
    };
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ ...base, id: 'ps', origem: 'site' }, { ...base, id: 'pv', origem: 'vendedor' }] })
      .mockResolvedValue({ rows: [] });
    const out = await runComTenant({ tenant: TENANT as never, pool: { query } as unknown as Pool }, () =>
      new DlinksPedidosService().listar('2026-11-13', '2026-11-13'));
    expect(out.pedidos.map((p) => p.origem)).toEqual(['app_cliente', 'vendedor']);
  });

  it('histórico do app do vendedor rotula pedido do site como app_cliente', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from vendedores where id')) return { rows: [{ id: 'v1', nome: 'Ana', erp_vendedor_id: '6' }] };
      if (sql.includes('/* historico */')) {
        return { rows: [{ id: 'a', numero: 1, cliente_id: 'c1', criado_em: 'x', total: '10', status: 'ENTREGUE', origem: 'site', itens: null }] };
      }
      return { rows: [] };
    });
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasSyncService().carga('v1'));
    expect(out.historico[0].origem).toBe('app_cliente');
  });

  it('mapa da retaguarda inclui pedido do site', async () => {
    const query = jest.fn(async () => ({ rows: [{}] }));
    await runComTenant({ tenant: TENANT as never, pool: { query } as never }, () =>
      new MapaService({ estado: () => ({}) } as never).mapa({ de: '2026-11-01', ate: '2026-11-13', status: ['RECEBIDO'] }));
    const sobrePedidos = query.mock.calls.map((c) => String((c as unknown[])[0])).filter((s) => s.includes('from pedidos p'));
    expect(sobrePedidos.length).toBe(2);
    for (const s of sobrePedidos) expect(s).toContain("p.origem in ('app_cliente','site')");
  });
});

describe("Nenhuma consulta deixa o pedido do site de fora com origem = 'app_cliente'", () => {
  it('nenhum arquivo de código (fora dos specs) compara origem só com app_cliente', () => {
    const raiz = join(__dirname, '..');
    const arquivos: string[] = [];
    const andar = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) andar(p);
        else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) arquivos.push(p);
      }
    };
    andar(raiz);
    const culpados = arquivos.filter((f) => /origem\s*=\s*'app_cliente'/.test(readFileSync(f, 'utf8')));
    expect(culpados).toEqual([]);
  });
});
