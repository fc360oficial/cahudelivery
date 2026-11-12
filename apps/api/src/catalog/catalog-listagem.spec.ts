import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from './catalog.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar(linhasProdutos: unknown[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from produtos p') && sql.includes('limit $')) return { rows: linhasProdutos };
    return { rows: [] };
  });
  const svc = new CatalogService({} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { svc, query, rodar };
}
const chamadas = (q: jest.Mock) => q.mock.calls.map((c) => ({ sql: String((c as unknown[])[0]), params: (c as unknown[])[1] as unknown[] }));
const listagem = (q: jest.Mock) => chamadas(q).find((c) => c.sql.includes('limit $'))!;

describe('CatalogService.produtos: listagem do site', () => {
  it('pede um item a mais e devolve temMais=true sem o item extra', async () => {
    const { svc, query, rodar } = montar([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const r = await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(listagem(query).params.slice(-2)).toEqual([3, 0]);
    expect(r.dados).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(r.temMais).toBe(true);
  });

  it('temMais=false quando não sobra item', async () => {
    const { svc, rodar } = montar([{ id: 'a' }]);
    const r = await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(r.dados).toHaveLength(1);
    expect(r.temMais).toBe(false);
  });

  it('ordem preco_asc ordena pelo preço final', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.produtos({ pagina: 1, limite: 2, ordem: 'preco_asc' }));
    expect(listagem(query).sql).toContain('order by coalesce(promo.preco_promocional, pr.preco) asc nulls last, p.nome, p.id limit');
  });

  it('ordem preco_desc ordena pelo preço final decrescente com desempate por id', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.produtos({ pagina: 1, limite: 2, ordem: 'preco_desc' }));
    expect(listagem(query).sql).toContain('order by coalesce(promo.preco_promocional, pr.preco) desc nulls last, p.nome, p.id limit');
  });

  it('ordem desconhecida cai em nome', async () => {
    for (const ordem of ['qualquer; drop table', 'constructor', 'toString']) {
      const { svc, query, rodar } = montar();
      await rodar(() => svc.produtos({ pagina: 1, limite: 2, ordem }));
      expect(listagem(query).sql).toContain('order by p.nome, p.id limit');
    }
  });

  it('produto traz marca_id', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(listagem(query).sql).toContain('p.marca_id');
  });
});

describe('CatalogService.marcas', () => {
  it('lista marcas com produto em estoque, filtrando pela categoria', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.marcas('cat-1'));
    const c = chamadas(query).find((x) => x.sql.includes('from marcas m'))!;
    expect(c.sql).toContain('e.quantidade > 0');
    expect(c.params).toEqual(['cat-1']);
  });

  it('sem categoria manda null', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.marcas());
    expect(chamadas(query).find((x) => x.sql.includes('from marcas m'))!.params).toEqual([null]);
  });
});
