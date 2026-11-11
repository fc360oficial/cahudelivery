import { BadRequestException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminVendasPainelService } from './admin-vendas-painel.service';

const V1 = '11111111-1111-4111-8111-111111111111';

interface Mocks {
  atual?: Record<string, unknown>;
  faturado?: Record<string, unknown>;
  meta?: unknown[];
  extras?: Record<string, unknown>;
  evolucao?: unknown[];
  categorias?: unknown[];
}

function montar(m: Mocks = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('/* janela */'))
      return { rows: [{ hoje: '2026-11-10', ini: '2026-11-10' }] };
    if (sql.includes('/* indicadores */')) {
      return {
        rows: [
          {
            pedidos: 6,
            pedidos_ant: 4,
            ...(m.atual ?? {}),
          },
        ],
      };
    }
    if (sql.includes('/* faturado */'))
      return {
        rows: [
          {
            vendido: '9840.00',
            pedidos_faturados: 4,
            vendido_ant: '8200.00',
            ...(m.faturado ?? {}),
          },
        ],
      };
    if (sql.includes('/* meta */'))
      return {
        rows: m.meta ?? [
          { id: V1, vendido_mes: '9840.00', vendido_ant: '0', erp_ant: null, percentual: null },
          { id: 'v2', vendido_mes: '0', vendido_ant: '0', erp_ant: null, percentual: null },
        ],
      };
    if (sql.includes('/* extras */')) {
      return {
        rows: [
          {
            carteira: 38,
            positivados: 28,
            retidos: 2,
            orc_qtd: 3,
            orc_total: '4500.50',
            ...(m.extras ?? {}),
          },
        ],
      };
    }
    if (sql.includes('/* evolucao */')) return { rows: m.evolucao ?? [] };
    if (sql.includes('/* recentes */')) {
      return {
        rows: [
          {
            id: 'p1',
            numero: '501',
            cliente: 'Mercado X',
            vendedor: 'Ana',
            tabela: 'Atacado',
            total: '120.50',
            status: 'RECEBIDO',
            criado_em: new Date('2026-11-10T14:00:00Z'),
          },
        ],
      };
    }
    if (sql.includes('/* ranking */'))
      return {
        rows: [
          { id: V1, nome: 'Ana', vendido: '9840.00', pedidos: 6, pedidos_faturados: 4 },
          { id: 'v2', nome: 'Bia', vendido: '0', pedidos: 0, pedidos_faturados: 0 },
        ],
      };
    if (sql.includes('/* categorias */')) return { rows: m.categorias ?? [] };
    return { rows: [] };
  });
  const rodar = <T>(fn: () => Promise<T>) =>
    runComTenant({ tenant: {}, pool: { query } } as never, fn);
  const sqlDe = (tag: string) =>
    String(query.mock.calls.find(([s]) => String(s).includes(tag))![0]);
  const paramsDe = (tag: string) =>
    query.mock.calls.find(([s]) => String(s).includes(tag))![1] as unknown[];
  return { svc: new AdminVendasPainelService(), rodar, sqlDe, paramsDe, query };
}

describe('AdminVendasPainelService.painel', () => {
  it('devolve o formato do contrato com números convertidos', async () => {
    const { svc, rodar } = montar({
      evolucao: [{ dia: '2026-11-10', vendido: '9840.00', pedidos: 6 }],
    });
    const out = await rodar(() => svc.painel({}));
    expect(out).toEqual({
      periodo: 'hoje',
      indicadores: {
        pedidos: 6,
        pedidosFaturados: 4,
        vendido: 9840,
        ticketMedio: 2460,
        variacaoPedidosPct: 50,
        variacaoVendidoPct: 20,
        positivacao: {
          clientesCarteira: 38,
          clientesPositivados: 28,
          pct: 73.7,
        },
        retidos: 2,
        orcamentosAbertos: { qtd: 3, total: 4500.5 },
        meta: { percentual: 5, metaMes: null, vendidoMes: 9840, atingidoPct: null },
      },
      evolucao: [{ dia: '2026-11-10', vendido: 9840, pedidos: 6 }],
      recentes: [
        {
          id: 'p1',
          numero: 501,
          cliente: 'Mercado X',
          vendedor: 'Ana',
          tabela: 'Atacado',
          total: 120.5,
          status: 'RECEBIDO',
          criadoEm: '2026-11-10T14:00:00.000Z',
        },
      ],
      ranking: [
        { vendedorId: V1, nome: 'Ana', vendido: 9840, pedidos: 6, pedidosFaturados: 4, vendidoMes: 9840, metaMes: null, atingidoPct: null },
        { vendedorId: 'v2', nome: 'Bia', vendido: 0, pedidos: 0, pedidosFaturados: 0, vendidoMes: 0, metaMes: null, atingidoPct: null },
      ],
      categorias: [],
    });
  });

  it('variação é null quando o período anterior é zero; ticket médio 0 sem pedidos', async () => {
    const { svc, rodar } = montar({
      atual: { pedidos: 0, pedidos_ant: 0 },
      faturado: { vendido: '0', pedidos_faturados: 0, vendido_ant: '0' },
    });
    const { indicadores } = await rodar(() => svc.painel({}));
    expect(indicadores.variacaoPedidosPct).toBeNull();
    expect(indicadores.variacaoVendidoPct).toBeNull();
    expect(indicadores.ticketMedio).toBe(0);
  });

  it('positivação com carteira zero dá 0', async () => {
    const { svc, rodar } = montar({ extras: { carteira: 0, positivados: 0 } });
    const { indicadores } = await rodar(() => svc.painel({}));
    expect(indicadores.positivacao).toEqual({
      clientesCarteira: 0,
      clientesPositivados: 0,
      pct: 0,
    });
  });

  it('vendido = faturado pelo ERP (pedido de vendedor, data do faturamento, fuso de Recife)', async () => {
    const { svc, rodar, sqlDe } = montar();
    await rodar(() => svc.painel({}));
    for (const tag of [
      '/* faturado */',
      '/* evolucao */',
      '/* ranking */',
      '/* categorias */',
      '/* meta */',
    ]) {
      const sql = sqlDe(tag);
      expect(sql).toContain("origem = 'vendedor'");
      expect(sql).toContain("'FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE'");
      expect(sql).toContain('pedido_faturamentos');
      expect(sql).toContain('faturado_em');
      expect(sql).toContain("'America/Recife'");
    }
    // contagem de pedidos segue a definição antiga (feitos e liberados)
    const ind = sqlDe('/* indicadores */');
    expect(ind).toContain("origem = 'vendedor'");
    expect(ind).toContain("'CANCELADO','AGUARDANDO_VENDEDOR'");
    expect(sqlDe('/* ranking */')).toContain("'CANCELADO','AGUARDANDO_VENDEDOR'");
    expect(sqlDe('/* extras */')).toContain("status = 'AGUARDANDO_VENDEDOR'");
    expect(sqlDe('/* recentes */')).toContain("origem = 'vendedor'");
    expect(sqlDe('/* recentes */')).toContain('limit 8');
  });

  it('filtra por vendedor só quando informado e rejeita id que não é UUID', async () => {
    const a = montar();
    await a.rodar(() => a.svc.painel({}));
    expect(a.paramsDe('/* indicadores */')).toContain(null);
    expect(a.paramsDe('/* faturado */')).toContain(null);
    const b = montar();
    await b.rodar(() => b.svc.painel({ vendedorId: V1 }));
    expect(b.paramsDe('/* indicadores */')).toContain(V1);
    expect(b.paramsDe('/* faturado */')).toContain(V1);
    const c = montar();
    await expect(
      c.rodar(() => c.svc.painel({ vendedorId: 'abc' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('janelas: hoje, semana (7 dias) e mês; anterior de mesmo tamanho', async () => {
    const { svc, rodar, paramsDe, query } = montar();
    await rodar(() => svc.painel({}));
    expect(paramsDe('/* janela */')).toEqual(['hoje']);
    // [ini, fim (exclusivo), ini do anterior, vendedor]
    expect(paramsDe('/* indicadores */').slice(0, 3)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-09',
    ]);
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('/* janela */'))
        return { rows: [{ hoje: '2026-11-10', ini: '2026-11-04' }] };
      return {
        rows: [
          {
            pedidos: 0,
            vendido: 0,
            pedidos_ant: 0,
            vendido_ant: 0,
            carteira: 0,
            positivados: 0,
            retidos: 0,
            orc_qtd: 0,
            orc_total: 0,
          },
        ],
      };
    });
    await rodar(() => svc.painel({ periodo: 'semana' }));
    const chamada = query.mock.calls
      .filter(([s]) => String(s).includes('/* indicadores */'))
      .pop()!;
    expect((chamada[1] as unknown[]).slice(0, 3)).toEqual([
      '2026-11-04',
      '2026-11-11',
      '2026-10-28',
    ]);
  });

  it('periodo e dias inválidos caem no padrão (hoje, 7 dias)', async () => {
    const { svc, rodar, paramsDe } = montar();
    const out = await rodar(() => svc.painel({ periodo: 'ano', dias: '15' }));
    expect(out.periodo).toBe('hoje');
    expect(paramsDe('/* janela */')).toEqual(['hoje']);
    // evolução: [início, hoje, fim, vendedor] = 7 dias terminando hoje
    expect(paramsDe('/* evolucao */').slice(0, 3)).toEqual([
      '2026-11-04',
      '2026-11-10',
      '2026-11-11',
    ]);
  });

  it('dias 30 e 90 abrem a janela da evolução; generate_series cobre todos os dias', async () => {
    const a = montar();
    await a.rodar(() => a.svc.painel({ dias: '30' }));
    expect(a.paramsDe('/* evolucao */')[0]).toBe('2026-10-12');
    const b = montar();
    await b.rodar(() => b.svc.painel({ dias: '90' }));
    expect(b.paramsDe('/* evolucao */')[0]).toBe('2026-08-13');
    expect(a.sqlDe('/* evolucao */')).toContain('generate_series');
  });

  it('categorias: 5 maiores + Outros, pct com uma casa e soma ~100', async () => {
    const cats = [
      ['A', 400],
      ['B', 300],
      ['C', 100],
      ['D', 80],
      ['E', 60],
      ['F', 40],
      ['G', 20],
    ].map(([nome, vendido]) => ({ nome, vendido: String(vendido) }));
    const { svc, rodar } = montar({ categorias: cats });
    const { categorias } = await rodar(() => svc.painel({}));
    expect(categorias.map((c) => c.nome)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'Outros',
    ]);
    expect(categorias[5]).toEqual({ nome: 'Outros', vendido: 60, pct: 6 });
    expect(categorias[0].pct).toBe(40);
    const soma = categorias.reduce((s, c) => s + c.pct, 0);
    expect(Math.abs(soma - 100)).toBeLessThan(0.5);
  });

  it('com até 5 categorias não cria Outros', async () => {
    const { svc, rodar } = montar({
      categorias: [
        { nome: 'A', vendido: '1' },
        { nome: 'B', vendido: '2' },
      ],
    });
    const { categorias } = await rodar(() => svc.painel({}));
    expect(categorias).toEqual([
      { nome: 'B', vendido: 2, pct: 66.7 },
      { nome: 'A', vendido: 1, pct: 33.3 },
    ]);
  });

  describe('meta do mês', () => {
    const linhas = (extra: Record<string, unknown>[] = []) => [
      { id: V1, vendido_mes: '21000.00', vendido_ant: '20000.00', erp_ant: null, percentual: null },
      { id: 'v2', vendido_mes: '3000.00', vendido_ant: '0', erp_ant: null, percentual: null },
      ...extra,
    ];

    it('meta = mês anterior x 1,05 por vendedor, mesmo com periodo=hoje', async () => {
      const { svc, rodar, paramsDe } = montar({ meta: linhas() });
      const out = await rodar(() => svc.painel({ periodo: 'hoje' }));
      // [início do mês anterior, início do mês atual, fim (exclusivo), ano-mês anterior, vendedor]
      expect(paramsDe('/* meta */')).toEqual(['2026-10-01', '2026-11-01', '2026-11-11', '2026-10', null]);
      expect(out.ranking[0]).toMatchObject({ vendedorId: V1, vendidoMes: 21000, metaMes: 21000, atingidoPct: 100 });
      expect(out.ranking[1]).toMatchObject({ vendedorId: 'v2', vendidoMes: 3000, metaMes: null, atingidoPct: null });
    });

    it('a base prefere a linha do ERP ao faturado próprio; sem linha, usa o próprio', async () => {
      const { svc, rodar } = montar({
        meta: [
          { id: V1, vendido_mes: '0', vendido_ant: '20000', erp_ant: '10000.00', percentual: null },
          { id: 'v2', vendido_mes: '0', vendido_ant: '2000', erp_ant: null, percentual: null },
          { id: 'v3', vendido_mes: '0', vendido_ant: '0', erp_ant: null, percentual: null },
          { id: 'v4', vendido_mes: '0', vendido_ant: '500', erp_ant: '0', percentual: null },
        ],
      });
      const out = await rodar(() => svc.painel({}));
      const porId = new Map(out.ranking.map((r) => [r.vendedorId, r.metaMes]));
      expect(porId.get(V1)).toBe(10500);
      expect(porId.get('v2')).toBe(2100);
      expect(out.indicadores.meta.metaMes).toBe(10500 + 2100);
    });

    it('percentual customizado das configurações', async () => {
      const { svc, rodar } = montar({
        meta: [{ id: V1, vendido_mes: '5000', vendido_ant: '10000', erp_ant: null, percentual: { valor: 20 } }],
      });
      const out = await rodar(() => svc.painel({}));
      expect(out.ranking[0]).toMatchObject({ metaMes: 12000, atingidoPct: 41.7 });
      expect(out.indicadores.meta).toEqual({ percentual: 20, metaMes: 12000, vendidoMes: 5000, atingidoPct: 41.7 });
    });

    it('atingido acima de 100 é mantido', async () => {
      const { svc, rodar } = montar({
        meta: [{ id: V1, vendido_mes: '31500', vendido_ant: '20000', erp_ant: null, percentual: null }],
      });
      const out = await rodar(() => svc.painel({}));
      expect(out.ranking[0].atingidoPct).toBe(150);
    });

    it('meta do time soma só os vendedores com meta; sem nenhum, null', async () => {
      const a = montar({
        meta: linhas([{ id: 'v3', vendido_mes: '1000', vendido_ant: '10000', erp_ant: null, percentual: null }]),
      });
      const out = await a.rodar(() => a.svc.painel({}));
      // metas: v1 21000 + v3 10500; faturado do time = 21000 + 3000 + 1000
      expect(out.indicadores.meta).toEqual({ percentual: 5, metaMes: 31500, vendidoMes: 22000, atingidoPct: 69.8 });
      const b = montar({
        meta: [{ id: V1, vendido_mes: '100', vendido_ant: '0', erp_ant: null, percentual: null }],
      });
      const o2 = await b.rodar(() => b.svc.painel({}));
      expect(o2.indicadores.meta).toEqual({ percentual: 5, metaMes: null, vendidoMes: 100, atingidoPct: null });
    });

    it('com vendedorId, a meta do indicador é a desse vendedor', async () => {
      const { svc, rodar, paramsDe } = montar({
        meta: [{ id: V1, vendido_mes: '21000', vendido_ant: '20000', erp_ant: null, percentual: null }],
      });
      const out = await rodar(() => svc.painel({ vendedorId: V1 }));
      expect(paramsDe('/* meta */')[4]).toBe(V1);
      expect(out.indicadores.meta).toEqual({ percentual: 5, metaMes: 21000, vendidoMes: 21000, atingidoPct: 100 });
    });

    it('a consulta de meta lê o faturado do ERP por vendedor e mês', async () => {
      const { svc, rodar, sqlDe } = montar();
      await rodar(() => svc.painel({}));
      const sql = sqlDe('/* meta */');
      expect(sql).toContain('vendedor_faturamento_mensal');
      expect(sql).toContain('vendas_meta_percentual');
    });
  });
});
