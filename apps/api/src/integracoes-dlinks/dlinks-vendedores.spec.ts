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

  it('faturamento mensal: upsert por (vendedor, mês) e ignora vendedor desconhecido', async () => {
    const { query, pool } = montar({}, { '6': 'vend-6' });
    const out = await rodar(pool, () =>
      new DlinksVendedoresService().syncFaturamentoMensal([
        { funcionario_codigo: '6', ano_mes: '2026-10', valor_faturado: 40000 },
        { funcionario_codigo: '99', ano_mes: '2026-10', valor_faturado: 10 },
      ]),
    );
    const up = query.mock.calls.filter(([sql]) => String(sql).includes('insert into vendedor_faturamento_mensal'));
    expect(up).toHaveLength(1);
    expect(String(up[0][0])).toContain('on conflict (vendedor_id, ano_mes) do update');
    expect(up[0][1]).toEqual(['vend-6', '2026-10', 40000]);
    expect(out.processados).toBe(1);
    expect(out.ignorados).toEqual([
      { item: { funcionario_codigo: '99', ano_mes: '2026-10', valor_faturado: 10 }, motivo: 'funcionario_nao_encontrado' },
    ]);
  });

  describe('devoluções', () => {
    const PED = '22222222-2222-4222-8222-222222222222';
    const PED_DELIVERY = '33333333-3333-4333-8333-333333333333';
    function montarDev() {
      const query = jest.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('from pedidos where id')) {
          if (params[0] === PED) return { rows: [{ id: PED, vendedor_id: 'vend-6', cliente_id: 'cli-1' }], rowCount: 1 };
          if (params[0] === PED_DELIVERY) return { rows: [{ id: PED_DELIVERY, vendedor_id: null, cliente_id: 'cli-2' }], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('from vendedores where erp_vendedor_id'))
          return params[0] === '7' ? { rows: [{ id: 'vend-7' }], rowCount: 1 } : { rows: [], rowCount: 0 };
        if (sql.includes('from clientes where erp_cliente_id'))
          return params[0] === 'C9' ? { rows: [{ id: 'cli-9' }], rowCount: 1 } : { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });
      return { query, pool: { query } };
    }
    const base = { numero_nota: '900', data: '2026-11-12', valor: 500 };

    it('devolução com pedido usa o vendedor e o cliente do pedido; upsert pela nota', async () => {
      const { query, pool } = montarDev();
      const out = await rodar(pool, () =>
        new DlinksVendedoresService().syncDevolucoes([{ ...base, pedido_codigo: PED, nota_venda_numero: '1234' }] as never),
      );
      const ins = query.mock.calls.filter(([sql]) => String(sql).includes('insert into devolucoes_venda'));
      expect(ins).toHaveLength(1);
      expect(String(ins[0][0])).toContain('on conflict (numero_nota, serie) do update');
      expect(String(ins[0][0])).toContain("($8::date)::timestamp at time zone 'America/Recife'");
      expect(ins[0][1]).toEqual(['900', '', 'vend-6', PED, 'cli-1', '1234', 500, '2026-11-12', null]);
      expect(out).toEqual({ processados: 1, ignorados: [] });
    });

    it('sem pedido, usa funcionario_codigo e cliente_codigo (venda que não nasceu no aplicativo)', async () => {
      const { query, pool } = montarDev();
      const out = await rodar(pool, () =>
        new DlinksVendedoresService().syncDevolucoes([{ ...base, serie: '1', funcionario_codigo: '7', cliente_codigo: 'C9', cancelada: true }] as never),
      );
      const ins = query.mock.calls.find(([sql]) => String(sql).includes('insert into devolucoes_venda'));
      expect(ins![1]).toEqual(['900', '1', 'vend-7', null, 'cli-9', null, 500, '2026-11-12', true]);
      expect(out.processados).toBe(1);
    });

    it('ignora o que não dá para atribuir a um vendedor, dizendo o motivo', async () => {
      const { query, pool } = montarDev();
      const out = await rodar(pool, () =>
        new DlinksVendedoresService().syncDevolucoes([
          { ...base, numero_nota: '1', pedido_codigo: '44444444-4444-4444-8444-444444444444' },
          { ...base, numero_nota: '2', pedido_codigo: 'nao-e-uuid' },
          { ...base, numero_nota: '3', pedido_codigo: PED_DELIVERY },
          { ...base, numero_nota: '4' },
          { ...base, numero_nota: '5', funcionario_codigo: '99' },
        ] as never),
      );
      expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into devolucoes_venda'))).toBe(false);
      expect(out.processados).toBe(0);
      expect(out.ignorados.map((i) => i.motivo)).toEqual([
        'pedido_nao_encontrado', 'pedido_nao_encontrado', 'pedido_sem_vendedor', 'sem_pedido_nem_funcionario', 'funcionario_nao_encontrado',
      ]);
    });
  });
});
