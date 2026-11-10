import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { solucaoExigida } from '../admin/solucoes';
import { AdminCatalogoController } from '../admin/admin-catalogo.controller';
import { AdminVendasCategoriasController } from './admin-vendas-categorias.controller';

function montar(rows: unknown[] = [{ id: 'c1' }]) {
  const query = jest.fn(async () => ({ rows }));
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool: { query } } as never, fn);
  return { query, rodar };
}

describe('categorias no painel de Vendas', () => {
  it('as rotas ficam sob /v1/admin/vendas/categorias, que exige a solução vendas', () => {
    expect(Reflect.getMetadata('path', AdminVendasCategoriasController)).toBe('admin/vendas/categorias');
    expect(solucaoExigida('/v1/admin/vendas/categorias')).toBe('vendas');
    expect(solucaoExigida('/v1/admin/vendas/categorias/abc')).toBe('vendas');
    const p = AdminVendasCategoriasController.prototype as never;
    const rotas = ['listar', 'criar', 'editar'].map((m) => [Reflect.getMetadata('method', p[m]), Reflect.getMetadata('path', p[m])]);
    expect(rotas).toEqual([[0, '/'], [1, '/'], [2, ':id']]);
  });

  it('listar, criar e editar usam o mesmo SQL do Delivery', async () => {
    const vendas = new AdminVendasCategoriasController();
    const delivery = new AdminCatalogoController();
    const sqls = async (c: { listar?: () => unknown; categorias?: () => unknown; criar?: unknown; criarCategoria?: unknown; editar?: unknown; editarCategoria?: unknown }) => {
      const { query, rodar } = montar();
      await rodar(async () => {
        await (c.listar ?? c.categorias)!.call(c);
        await ((c.criar ?? c.criarCategoria) as (d: unknown) => unknown).call(c, { nome: 'Bebidas' });
        await ((c.editar ?? c.editarCategoria) as (i: string, d: unknown) => unknown).call(c, 'c1', { nome: 'Bebidas', ativo: false });
      });
      return query.mock.calls.map(([sql]) => String(sql));
    };
    const a = await sqls(vendas as never);
    const b = await sqls(delivery as never);
    expect(a).toEqual(b);
    expect(a[0]).toContain('from categorias c order by c.ordem, c.nome');
    expect(a[1]).toContain('insert into categorias');
    expect(a[2]).toContain('update categorias set nome=$2');
  });

  it('editar categoria inexistente dá 404', async () => {
    const { rodar } = montar([]);
    await expect(rodar(() => new AdminVendasCategoriasController().editar('c9', { nome: 'X' } as never))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('editar sem imagemUrl mantém a foto atual (flag $7 verdadeira)', async () => {
    const { query, rodar } = montar();
    await rodar(() => new AdminVendasCategoriasController().editar('c1', { nome: 'X', ativo: false } as never));
    expect((query.mock.calls[0] as unknown[])[1]).toEqual(['c1', 'X', null, null, undefined, false, true]);
  });
});
