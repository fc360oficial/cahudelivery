import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from './catalog.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from produtos p left join categorias c on c.id = p.categoria_id where p.id')) {
      return { rows: [{ categoria_id: 'cat-1', pai_id: null }] };
    }
    return { rows: [] };
  });
  const svc = new CatalogService({} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { svc, query, rodar };
}
const sqls = (q: jest.Mock) => q.mock.calls.map((c) => String((c as unknown[])[0]));

describe('CatalogService — popularidade só com pedidos do app do cliente', () => {
  it('home: "mais vendidos" lê só origem app_cliente', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.home());
    const maisVendidos = sqls(query).filter((s) => s.includes('join pedidos pe'));
    expect(maisVendidos).toHaveLength(1);
    expect(maisVendidos[0]).toContain("origem = 'app_cliente'");
  });

  it('relacionados: toda leitura de pedido_itens passa por pedidos app_cliente', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.relacionados('prod-1'));
    const lidas = sqls(query).filter((s) => s.includes('pedido_itens'));
    expect(lidas.length).toBeGreaterThanOrEqual(3);
    for (const s of lidas) {
      expect(s).toContain("origem = 'app_cliente'");
    }
  });
});
