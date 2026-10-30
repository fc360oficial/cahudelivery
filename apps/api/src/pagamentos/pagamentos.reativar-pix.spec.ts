import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';

/**
 * PIX pago depois de o sistema dar por vencido (pedido #12, 30/10/2026): reativa
 * o pedido quando ele nunca chegou ao ERP e o saldo usado ainda está na carteira;
 * senão o pagamento fica 'pago' com o pedido cancelado e o worker credita na carteira.
 */
function fakePool(pedido: Record<string, unknown>, upRowCount = 1) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes("where id = $1 and status = 'expirado' returning pedido_id")) {
      return { rowCount: upRowCount, rows: upRowCount ? [{ pedido_id: 'ped-12' }] : [] };
    }
    if (sql.includes('as foi_pro_erp')) return { rows: [pedido] };
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query };
}

const sqlsCom = (query: jest.Mock, trecho: string) => query.mock.calls.filter((c) => String(c[0]).includes(trecho));
const PEDIDO = { status: 'CANCELADO', numero: 12, cliente_id: 'cli-1', valor_saldo_usado: '0', erp_pedido_id: null, foi_pro_erp: false, saldo: '0' };

describe('PagamentosService.reativarPagoAposVencer', () => {
  it('pedido cancelado só pelo vencimento: reativa, volta pra RECEBIDO e entra na fila do ERP', async () => {
    const { pool, query } = fakePool(PEDIDO);
    const r = await new PagamentosService().reativarPagoAposVencer(pool, 'pag-1', 150, new Date());
    expect(r).toBe('reativado');
    expect(sqlsCom(query, "set status = 'pago'")).toHaveLength(1);
    expect(sqlsCom(query, "update pedidos set status = 'RECEBIDO'")).toHaveLength(1);
    expect(sqlsCom(query, 'insert into sync_outbox')).toHaveLength(1);
  });

  it('usava saldo da carteira: debita de novo ao reativar', async () => {
    const { pool, query } = fakePool({ ...PEDIDO, valor_saldo_usado: '30', saldo: '30' });
    expect(await new PagamentosService().reativarPagoAposVencer(pool, 'pag-1', 120, new Date())).toBe('reativado');
    expect(sqlsCom(query, 'insert into carteira_movimentos')[0][1]).toEqual(expect.arrayContaining(['cli-1', -30]));
  });

  it('cliente já gastou o saldo que o pedido usava: não reativa, vira crédito', async () => {
    const { pool, query } = fakePool({ ...PEDIDO, valor_saldo_usado: '30', saldo: '10' });
    expect(await new PagamentosService().reativarPagoAposVencer(pool, 'pag-1', 120, new Date())).toBe('credito');
    expect(sqlsCom(query, "set status = 'pago'")).toHaveLength(1); // worker credita pago + CANCELADO
    expect(sqlsCom(query, "update pedidos set status = 'RECEBIDO'")).toHaveLength(0);
  });

  it('pedido que já tinha ido pro ERP não é reativado', async () => {
    const { pool, query } = fakePool({ ...PEDIDO, foi_pro_erp: true });
    expect(await new PagamentosService().reativarPagoAposVencer(pool, 'pag-1', 150, new Date())).toBe('credito');
    expect(sqlsCom(query, 'insert into sync_outbox')).toHaveLength(0);
  });

  it('pagamento que não está expirado: não mexe', async () => {
    const { pool, query } = fakePool(PEDIDO, 0);
    expect(await new PagamentosService().reativarPagoAposVencer(pool, 'pag-1', 150, new Date())).toBe('nada');
    expect(sqlsCom(query, 'update pedidos')).toHaveLength(0);
  });
});
