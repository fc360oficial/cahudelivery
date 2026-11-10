import { runComTenant } from '../tenancy/tenant-context';
import { AdminService } from './admin.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar(rows: Record<string, unknown>[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('count(*) filter (where status <> \'excluido\')')) {
      return { rows: [{ total: 0, aprovados: 0, pendentes: 0, bloqueados: 0, novos_30d: 0, compraram_30d: 0 }] };
    }
    if (sql.includes("status = 'FALHA_INTEGRACAO'")) return { rows: [{ qtd: 0 }] };
    return { rows };
  });
  const svc = new AdminService({} as never, {} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { svc, query, rodar };
}
const chamada = (q: jest.Mock, i = 0) => q.mock.calls[i] as [string, unknown[]];

describe('AdminService.dashboard — só números do Delivery (origem app_cliente)', () => {
  it('toda consulta sobre pedidos filtra a origem', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.dashboard());
    const sobrePedidos = query.mock.calls.map((c) => String((c as unknown[])[0])).filter((s) => /(from|join) pedidos/.test(s));
    expect(sobrePedidos.length).toBeGreaterThanOrEqual(6);
    for (const s of sobrePedidos) expect(s).toContain("origem = 'app_cliente'");
  });
});

describe('AdminService.pedidos — filtro de origem', () => {
  it('sem origem usa app_cliente', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.pedidos({ pagina: 1 }));
    const [sql, params] = chamada(query);
    expect(sql).toContain('p.origem = $1');
    expect(params[0]).toBe('app_cliente');
  });
  it("origem 'vendedor' filtra por vendedor", async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.pedidos({ origem: 'vendedor', pagina: 1 }));
    expect(chamada(query)[1][0]).toBe('vendedor');
  });
  it("origem 'todos' não filtra por origem", async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.pedidos({ origem: 'todos', pagina: 1 }));
    const [sql, params] = chamada(query);
    expect(sql).not.toContain('p.origem =');
    expect(params).toEqual([0]);
  });
  it('valor inválido cai em app_cliente', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.pedidos({ origem: "x' or 1=1", pagina: 1 }));
    expect(chamada(query)[1][0]).toBe('app_cliente');
  });
  it('devolve origem e vendedor_nome nas linhas e mantém os campos existentes', async () => {
    const linha = { id: 'p1', numero: 1, status: 'RECEBIDO', total: '10', cliente: 'X', documento: '1', origem: 'vendedor', vendedor_nome: 'Ana' };
    const { svc, query, rodar } = montar([linha]);
    const out = await rodar(() => svc.pedidos({ origem: 'todos', pagina: 1 }));
    expect(out.dados[0]).toEqual(linha);
    const sql = chamada(query)[0];
    expect(sql).toContain('left join vendedores v on v.id = p.vendedor_id');
    expect(sql).toContain('p.origem, v.nome as vendedor_nome');
    expect(sql).toContain('p.erp_pedido_id');
  });
});

describe('AdminService.pedido — detalhe traz o nome do vendedor', () => {
  it('seleciona vendedor_nome sem filtrar origem', async () => {
    const { svc, query, rodar } = montar([{ id: 'p1', origem: 'vendedor', vendedor_nome: 'Ana', pagamento: null }]);
    const out = await rodar(() => svc.pedido('p1'));
    const sql = chamada(query)[0];
    expect(sql).toContain('v.nome as vendedor_nome');
    expect(sql).toContain('left join vendedores v on v.id = p.vendedor_id');
    expect(sql).not.toContain("origem = 'app_cliente'");
    expect(out).toMatchObject({ origem: 'vendedor', vendedor_nome: 'Ana' });
  });
});
