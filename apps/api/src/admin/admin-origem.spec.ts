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
    for (const s of sobrePedidos) expect(s).toContain("origem in ('app_cliente','site')");
  });
});

describe('AdminService.pedidos — sempre só Delivery', () => {
  it('filtra app_cliente e ignora um argumento origem', async () => {
    for (const origem of [undefined, 'vendedor', 'todos', "x' or 1=1"]) {
      const { svc, query, rodar } = montar();
      await rodar(() => svc.pedidos({ origem, pagina: 1 } as never));
      const [sql, params] = chamada(query);
      expect(sql).toContain("p.origem in ('app_cliente','site')");
      expect(params).toEqual([0]);
    }
  });
  it('mantém os campos devolvidos (inclui origem)', async () => {
    const linha = { id: 'p1', numero: 1, status: 'RECEBIDO', total: '10', cliente: 'X', documento: '1', origem: 'app_cliente' };
    const { svc, query, rodar } = montar([linha]);
    const out = await rodar(() => svc.pedidos({ pagina: 1 }));
    expect(out.dados[0]).toEqual(linha);
    const sql = chamada(query)[0];
    expect(sql).toContain('p.origem');
    expect(sql).toContain('p.erp_pedido_id');
    expect(sql).not.toContain('vendedores');
  });
});

describe('AdminService — buscas por id só enxergam pedido do Delivery', () => {
  const PRED = "origem in ('app_cliente','site')";
  it('detalhe do pedido', async () => {
    const { svc, query, rodar } = montar([{ id: 'p1', origem: 'app_cliente', pagamento: null }]);
    await rodar(() => svc.pedido('p1'));
    expect(chamada(query)[0]).toContain("p.origem in ('app_cliente','site')");
  });
  it('reenviarErp, consultarPagamento e simularPagamento', async () => {
    const a = montar();
    await expect(a.rodar(() => a.svc.reenviarErp('p1', 'u1'))).rejects.toThrow();
    expect(chamada(a.query)[0]).toContain(PRED);
    const b = montar();
    await expect(b.rodar(() => b.svc.consultarPagamento('p1'))).rejects.toThrow();
    expect(chamada(b.query)[0]).toContain(PRED);
    const c = montar();
    (c.svc as never as { provedores: unknown }).provedores = { obter: async () => ({ provedor: { nome: 'mock' } }) };
    await expect(c.rodar(() => c.svc.simularPagamento('p1'))).rejects.toThrow();
    expect(chamada(c.query)[0]).toContain(PRED);
  });
  it('contagem de pedidos do cliente só conta app_cliente', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.clientes({ pagina: 1 }));
    const sqls = query.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(sqls.some((q) => q.includes("p.cliente_id = clientes.id and p.origem in ('app_cliente','site')"))).toBe(true);
  });
});
