import { BadRequestException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminVendasPainelService } from './admin-vendas-painel.service';

const V1 = '11111111-1111-4111-8111-111111111111';

interface Mocks {
  atual?: Record<string, unknown>;
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
            vendido: '9840.00',
            pedidos_ant: 4,
            vendido_ant: '8200.00',
            ...(m.atual ?? {}),
          },
        ],
      };
    }
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
          { id: V1, nome: 'Ana', vendido: '9840.00', pedidos: 6 },
          { id: 'v2', nome: 'Bia', vendido: '0', pedidos: 0 },
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
        vendido: 9840,
        ticketMedio: 1640,
        variacaoPedidosPct: 50,
        variacaoVendidoPct: 20,
        positivacao: {
          clientesCarteira: 38,
          clientesPositivados: 28,
          pct: 73.7,
        },
        retidos: 2,
        orcamentosAbertos: { qtd: 3, total: 4500.5 },
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
        { vendedorId: V1, nome: 'Ana', vendido: 9840, pedidos: 6 },
        { vendedorId: 'v2', nome: 'Bia', vendido: 0, pedidos: 0 },
      ],
      categorias: [],
    });
  });

  it('variação é null quando o período anterior é zero; ticket médio 0 sem pedidos', async () => {
    const { svc, rodar } = montar({
      atual: { pedidos: 0, vendido: '0', pedidos_ant: 0, vendido_ant: '0' },
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

  it('só pedidos de vendedor, exclui cancelado/retido e usa o fuso de Recife', async () => {
    const { svc, rodar, sqlDe } = montar();
    await rodar(() => svc.painel({}));
    for (const tag of [
      '/* indicadores */',
      '/* evolucao */',
      '/* ranking */',
      '/* categorias */',
    ]) {
      const sql = sqlDe(tag);
      expect(sql).toContain("origem = 'vendedor'");
      expect(sql).toContain("'CANCELADO','AGUARDANDO_VENDEDOR'");
      expect(sql).toContain("'America/Recife'");
    }
    expect(sqlDe('/* extras */')).toContain("status = 'AGUARDANDO_VENDEDOR'");
    expect(sqlDe('/* recentes */')).toContain("origem = 'vendedor'");
    expect(sqlDe('/* recentes */')).toContain('limit 8');
  });

  it('filtra por vendedor só quando informado e rejeita id que não é UUID', async () => {
    const a = montar();
    await a.rodar(() => a.svc.painel({}));
    expect(a.paramsDe('/* indicadores */')).toContain(null);
    const b = montar();
    await b.rodar(() => b.svc.painel({ vendedorId: V1 }));
    expect(b.paramsDe('/* indicadores */')).toContain(V1);
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
});
