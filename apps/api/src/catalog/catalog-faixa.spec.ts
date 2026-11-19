import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from './catalog.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar(faixa: (sql: string) => Promise<{ rows: unknown[] }>) {
  const query = jest.fn(async (sql: string) => (sql.includes('pm.faixa_url') ? faixa(sql) : { rows: [] }));
  const svc = new CatalogService({} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { svc, query, rodar };
}

describe('CatalogService — faixa de campanha da home', () => {
  it('devolve a faixa da promoção vigente (só vigente, ativa e com produto)', async () => {
    const { svc, query, rodar } = montar(async () => ({
      rows: [{ nome: 'Ofertas da Semana', faixa_url: 'https://x/uploads/faixa.webp', faixa_celular_url: null }],
    }));
    const home = await rodar(() => svc.home());
    expect(home.faixaCampanha).toEqual({ nome: 'Ofertas da Semana', imagemUrl: 'https://x/uploads/faixa.webp', imagemCelularUrl: null });
    const sql = query.mock.calls.map((c) => String((c as unknown[])[0])).find((s) => s.includes('pm.faixa_url')) as string;
    expect(sql).toContain('pm.ativo and now() between pm.inicio_em and pm.fim_em');
    expect(sql).toContain('pm.faixa_url is not null');
    expect(sql).toContain('from promocao_produtos pp where pp.promocao_id = pm.id');
  });

  it('sem promoção com faixa: nulo', async () => {
    const { svc, rodar } = montar(async () => ({ rows: [] }));
    expect((await rodar(() => svc.home())).faixaCampanha).toBeNull();
  });

  it('banco ainda sem a coluna (migração 045 não aplicada): a home segue no ar, sem faixa', async () => {
    const aviso = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { svc, rodar } = montar(async () => { throw new Error('column pm.faixa_url does not exist'); });
    const home = await rodar(() => svc.home());
    expect(home.faixaCampanha).toBeNull();
    expect(Array.isArray(home.banners)).toBe(true);
    aviso.mockRestore();
  });
});
