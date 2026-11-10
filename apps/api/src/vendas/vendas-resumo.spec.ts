import { runComTenant } from '../tenancy/tenant-context';
import { VendasResumoService } from './vendas-resumo.service';

describe('VendasResumoService.resumo', () => {
  it('converte os números e calcula o ticket médio', async () => {
    const query = jest.fn(async () => ({ rows: [{
      vendido_hoje: '9840.00', pedidos_hoje: 6, vendido_mes: '46200.00', carteira: 38, positivados: 28, retidos: 1, orcamentos: 2,
    }] }));
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasResumoService().resumo('v1'));
    expect(out).toEqual({
      vendidoHoje: 9840, pedidosHoje: 6, ticketMedioHoje: 1640, vendidoMes: 46200,
      clientesCarteira: 38, clientesPositivadosMes: 28, pedidosRetidos: 1, orcamentosAbertos: 2,
    });
    expect(String(query.mock.calls[0][0])).toContain("'America/Recife'");
    expect(query.mock.calls[0][1]).toEqual(['v1']);
  });

  it('ticket médio é zero em dia sem pedido', async () => {
    const query = jest.fn(async () => ({ rows: [{
      vendido_hoje: '0', pedidos_hoje: 0, vendido_mes: '0', carteira: 38, positivados: 0, retidos: 0, orcamentos: 0,
    }] }));
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasResumoService().resumo('v1'));
    expect(out.ticketMedioHoje).toBe(0);
  });
});
