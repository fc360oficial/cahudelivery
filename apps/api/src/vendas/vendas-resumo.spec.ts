import { runComTenant } from '../tenancy/tenant-context';
import { VendasResumoService } from './vendas-resumo.service';

/** Roteia por trecho do SQL: a consulta de meta traz vendido_anterior e percentual. */
function montar(principal: Record<string, unknown>, meta: Record<string, unknown> = {}) {
  const query = jest.fn(async (sql: string) =>
    String(sql).includes('/* meta */')
      ? { rows: [{ vendido_anterior: '0', erp_anterior: null, percentual: null, ...meta }] }
      : { rows: [principal] },
  );
  const rodar = () => runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasResumoService().resumo('v1'));
  return { query, rodar };
}

const BASE = { vendido_hoje: '0', pedidos_hoje: 0, vendido_mes: '0', faturados_hoje: 0, faturados_mes: 0, pedidos_mes: 0, carteira: 38, positivados: 0, retidos: 0, orcamentos: 0 };

describe('VendasResumoService.resumo', () => {
  it('converte os números e calcula o ticket médio', async () => {
    const { query, rodar } = montar({
      vendido_hoje: '9840.00', pedidos_hoje: 6, vendido_mes: '46200.00', faturados_hoje: 5, faturados_mes: 22, pedidos_mes: 31, carteira: 38, positivados: 28, retidos: 1, orcamentos: 2,
    });
    const out = await rodar();
    expect(out).toEqual({
      vendidoHoje: 9840, pedidosHoje: 6, ticketMedioHoje: 1968, vendidoMes: 46200, pedidosMes: 31, pedidosFaturadosMes: 22,
      clientesCarteira: 38, clientesPositivadosMes: 28, pedidosRetidos: 1, orcamentosAbertos: 2,
      meta: { percentual: 5, vendidoMesAnterior: 0, origemBase: null, metaMes: null, atingidoPct: null, faltam: null },
    });
    expect(String(query.mock.calls[0][0])).toContain("'America/Recife'");
    expect(query.mock.calls[0][1]).toEqual(['v1']);
  });

  it('ticket médio é faturado de hoje ÷ pedidos faturados hoje', async () => {
    const out = await montar({ ...BASE, vendido_hoje: '900', faturados_hoje: 3, pedidos_hoje: 10 }).rodar();
    expect(out.ticketMedioHoje).toBe(300);
    expect(out.pedidosHoje).toBe(10);
  });

  it('só conta pedido de vendedor faturado pelo ERP, pela data do faturamento', async () => {
    const { query, rodar } = montar(BASE);
    await rodar();
    const sql = String(query.mock.calls.find(([s]) => String(s).includes('vendido_hoje'))![0]);
    expect(sql).toContain("'FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE'");
    expect(sql).toContain('pedido_faturamentos');
    expect(sql).toContain('faturado_em');
    expect(sql).toContain("origem = 'vendedor'");
  });

  it('ticket médio é zero em dia sem pedido', async () => {
    const out = await montar(BASE).rodar();
    expect(out.ticketMedioHoje).toBe(0);
  });

  it('meta = mês anterior x 1,05; atingido e faltam calculados', async () => {
    const out = await montar({ ...BASE, vendido_mes: '30000.00' }, { vendido_anterior: '40000.00' }).rodar();
    expect(out.meta).toEqual({ percentual: 5, vendidoMesAnterior: 40000, origemBase: 'pedidos', metaMes: 42000, atingidoPct: 71.4, faltam: 12000 });
  });

  it('a base do mês anterior prefere a linha do ERP ao nosso próprio faturado', async () => {
    const out = await montar({ ...BASE, vendido_mes: '1000' }, { vendido_anterior: '40000', erp_anterior: '10000.00' }).rodar();
    expect(out.meta).toMatchObject({ vendidoMesAnterior: 10000, origemBase: 'erp', metaMes: 10500, faltam: 9500 });
  });

  it('sem linha do ERP cai no faturado próprio; os dois zerados = sem meta', async () => {
    const a = await montar(BASE, { vendido_anterior: '2000', erp_anterior: null }).rodar();
    expect(a.meta).toMatchObject({ vendidoMesAnterior: 2000, origemBase: 'pedidos', metaMes: 2100 });
    const b = await montar(BASE, { vendido_anterior: '0', erp_anterior: null }).rodar();
    expect(b.meta).toMatchObject({ vendidoMesAnterior: 0, origemBase: null, metaMes: null });
    const c = await montar(BASE, { vendido_anterior: '500', erp_anterior: '0' }).rodar();
    expect(c.meta).toMatchObject({ vendidoMesAnterior: 0, origemBase: null, metaMes: null });
  });

  it('percentual vem das configurações (valor_json.valor)', async () => {
    const out = await montar({ ...BASE, vendido_mes: '1000' }, { vendido_anterior: '10000', percentual: { valor: 10 } }).rodar();
    expect(out.meta).toMatchObject({ percentual: 10, metaMes: 11000, atingidoPct: 9.1, faltam: 10000 });
  });

  it('mês anterior sem venda: sem meta, tudo null, sem divisão por zero', async () => {
    const out = await montar({ ...BASE, vendido_mes: '5000' }, { vendido_anterior: '0' }).rodar();
    expect(out.meta).toEqual({ percentual: 5, vendidoMesAnterior: 0, origemBase: null, metaMes: null, atingidoPct: null, faltam: null });
  });

  it('meta batida: atingido passa de 100 e faltam nunca é negativo', async () => {
    const out = await montar({ ...BASE, vendido_mes: '63000' }, { vendido_anterior: '40000' }).rodar();
    expect(out.meta).toMatchObject({ metaMes: 42000, atingidoPct: 150, faltam: 0 });
  });

  it('a consulta de meta usa o mês anterior de Recife, só pedido de vendedor faturado', async () => {
    const { query, rodar } = montar(BASE);
    await rodar();
    const sql = String(query.mock.calls.find(([s]) => String(s).includes('/* meta */'))![0]);
    expect(sql).toContain("origem = 'vendedor'");
    expect(sql).toContain("'FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE'");
    expect(sql).toContain('vendedor_faturamento_mensal');
    expect(sql).toContain("interval '1 month'");
    expect(sql).toContain("'America/Recife'");
    expect(sql).toContain('vendas_meta_percentual');
  });
});
