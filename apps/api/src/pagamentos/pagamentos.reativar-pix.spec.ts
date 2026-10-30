import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';

/**
 * PIX pago depois de o sistema dar por vencido (pedido #12, 30/10/2026): o
 * pagamento vira 'pago', o pedido CONTINUA cancelado (nunca volta pro ERP
 * sozinho) e o worker credita o valor na carteira.
 */
function fakePool(upRowCount = 1) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("where id = $1 and status = 'expirado' returning pedido_id")) {
      return { rowCount: upRowCount, rows: upRowCount ? [{ pedido_id: 'ped-12' }] : [] };
    }
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query };
}

const sqlsCom = (query: jest.Mock, trecho: string) => query.mock.calls.filter((c) => String(c[0]).includes(trecho));

describe('PagamentosService.registrarPagoAposVencer', () => {
  it('marca pago e registra na linha do tempo, sem reativar o pedido nem mandar pro ERP', async () => {
    const { pool, query } = fakePool();
    expect(await new PagamentosService().registrarPagoAposVencer(pool, 'pag-1', 150, new Date())).toBe(true);
    expect(sqlsCom(query, "set status = 'pago'")).toHaveLength(1);
    expect(String(sqlsCom(query, 'insert into pedido_eventos')[0][0])).toContain('crédito na carteira');
    expect(sqlsCom(query, 'update pedidos')).toHaveLength(0);
    expect(sqlsCom(query, 'insert into sync_outbox')).toHaveLength(0);
  });

  it('pagamento que não está expirado: não mexe', async () => {
    const { pool, query } = fakePool(0);
    expect(await new PagamentosService().registrarPagoAposVencer(pool, 'pag-1', 150, new Date())).toBe(false);
    expect(sqlsCom(query, 'insert into pedido_eventos')).toHaveLength(0);
  });
});
