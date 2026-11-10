import { runComTenant } from '../tenancy/tenant-context';
import { DlinksVendedoresService } from './dlinks-vendedores.service';

function montar(clientes: Record<string, string>, vendedores: Record<string, string>) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from clientes where erp_cliente_id')) {
      const id = clientes[String(params[0])];
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.includes('from vendedores where erp_vendedor_id')) {
      const id = vendedores[String(params[0])];
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { query, pool };
}

const rodar = <T>(pool: unknown, fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);

describe('DlinksVendedoresService', () => {
  it('grava o vendedor pelo código do ERP sem apagar o ativo quando o campo não vem', async () => {
    const { query, pool } = montar({}, {});
    const out = await rodar(pool, () => new DlinksVendedoresService().syncFuncionarios([{ codigo: '6', nome: 'Vendedor Seis' }] as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into vendedores'));
    expect(String(insert![0])).toContain('on conflict (erp_vendedor_id)');
    expect(String(insert![0])).toContain('ativo = coalesce($4::boolean, vendedores.ativo)');
    expect(insert![1]).toEqual(['6', 'Vendedor Seis', null, null]);
    expect(out).toEqual({ processados: 1, ignorados: [] });
  });

  it('substitui a carteira dos clientes enviados e ignora códigos desconhecidos', async () => {
    const { query, pool } = montar({ C1: 'cli-1' }, { '6': 'vend-6' });
    const out = await rodar(pool, () =>
      new DlinksVendedoresService().syncCarteira([
        { cliente_codigo: 'C1', funcionario_codigo: '6' },
        { cliente_codigo: 'C9', funcionario_codigo: '6' },
        { cliente_codigo: 'C1', funcionario_codigo: '99' },
      ] as never),
    );
    const apagar = query.mock.calls.find(([sql]) => String(sql).includes('delete from cliente_vendedor'));
    expect(apagar![1]).toEqual([['cli-1']]);
    const inserir = query.mock.calls.filter(([sql]) => String(sql).includes('insert into cliente_vendedor'));
    expect(inserir).toHaveLength(1);
    expect(inserir[0][1]).toEqual(['cli-1', 'vend-6']);
    expect(out.processados).toBe(1);
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['cliente_nao_encontrado', 'funcionario_nao_encontrado']);
  });

  it('cliente enviado com vendedor vazio sai de todas as carteiras', async () => {
    const { query, pool } = montar({ C1: 'cli-1' }, {});
    const out = await rodar(pool, () =>
      new DlinksVendedoresService().syncCarteira([{ cliente_codigo: 'C1', funcionario_codigo: '' }] as never),
    );
    const apagar = query.mock.calls.find(([sql]) => String(sql).includes('delete from cliente_vendedor'));
    expect(apagar![1]).toEqual([['cli-1']]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into cliente_vendedor'))).toBe(false);
    expect(out.processados).toBe(1);
  });
});
