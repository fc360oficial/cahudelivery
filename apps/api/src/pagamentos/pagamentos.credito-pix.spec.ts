import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';

/**
 * PIX devolvido vira crédito na carteira (padrão) e o dinheiro só volta quando
 * o cliente pede. Pool falso casado por trecho de SQL.
 */
function fakePool(linha: Record<string, unknown> | null) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('from pagamentos g join pedidos p') && sql.includes('for update')) return { rows: linha ? [linha] : [] };
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query };
}

const sqlsCom = (query: jest.Mock, trecho: string) => query.mock.calls.filter((c) => String(c[0]).includes(trecho));

const PIX = {
  id: 'pag-1', pedido_id: 'ped-1', status: 'pago', metodo: 'pix', valor: '150.00', valor_pago: '150.00', numero: 42,
  cliente_id: 'cli-1', pedido_status: 'CANCELADO', valor_saldo_usado: '0', faturado: null, ja_devolvido: '0',
};

describe('PagamentosService.creditarPixNaCarteira', () => {
  it('pedido cancelado: credita tudo na carteira e o pagamento vira creditado', async () => {
    const { pool, query } = fakePool(PIX);
    const r = await new PagamentosService().creditarPixNaCarteira(pool, 'pag-1', { modo: 'cancelado', origem: 'sistema' });
    expect(r.creditado).toBe(150);
    expect(sqlsCom(query, 'insert into carteira_movimentos')[0][1]).toEqual(expect.arrayContaining(['cli-1', 150]));
    expect(sqlsCom(query, "values ($1,$2,'carteira','concluido'")).toHaveLength(1);
    expect(sqlsCom(query, "set status = 'creditado'")).toHaveLength(1);
  });

  it('faturado menor: credita só a diferença (contando o saldo usado) e o pagamento segue pago', async () => {
    // pedido de 200: 50 de saldo + 150 no PIX; faturou 180 → volta 20
    const { pool, query } = fakePool({ ...PIX, pedido_status: 'FATURADO', valor_saldo_usado: '50', faturado: '180.00' });
    const r = await new PagamentosService().creditarPixNaCarteira(pool, 'pag-1', { modo: 'diferenca', origem: 'sistema' });
    expect(r.creditado).toBe(20);
    expect(sqlsCom(query, "set status = 'creditado'")).toHaveLength(0);
  });

  it('diferença já creditada antes: não credita de novo', async () => {
    const { pool, query } = fakePool({ ...PIX, pedido_status: 'FATURADO', faturado: '130.00', ja_devolvido: '20.00' });
    const r = await new PagamentosService().creditarPixNaCarteira(pool, 'pag-1', { modo: 'diferenca', origem: 'sistema' });
    expect(r.creditado).toBe(0);
    expect(sqlsCom(query, 'insert into carteira_movimentos')).toHaveLength(0);
  });

  it('cartão ou pagamento que não está pago: não mexe', async () => {
    for (const linha of [{ ...PIX, metodo: 'cartao' }, { ...PIX, status: 'creditado' }, { ...PIX, pedido_status: 'ENTREGUE' }]) {
      const { pool, query } = fakePool(linha);
      const r = await new PagamentosService().creditarPixNaCarteira(pool, 'pag-1', { modo: 'cancelado', origem: 'sistema' });
      expect(r.creditado).toBe(0);
      expect(sqlsCom(query, 'insert into carteira_movimentos')).toHaveLength(0);
    }
  });
});

describe('PagamentosService.registrarDevolucaoPix', () => {
  const CREDITADO = { id: 'pag-1', pedido_id: 'ped-1', metodo: 'pix', status: 'creditado', numero: 42, cliente_id: 'cli-1',
    pedido_status: 'CANCELADO', creditado_restante: '150.00', saldo: '150.00' };

  it('devolve em dinheiro: tira da carteira e o pagamento vira estornado', async () => {
    const { pool, query } = fakePool(CREDITADO);
    const r = await new PagamentosService().registrarDevolucaoPix(pool, 'pag-1', { valor: 150, motivo: 'Cliente pediu', usuarioAdminId: 'adm-1' });
    expect(r.devolvido).toBe(150);
    expect(sqlsCom(query, 'insert into carteira_movimentos')[0][1]).toEqual(expect.arrayContaining(['cli-1', -150]));
    expect(sqlsCom(query, "set status = 'estornado'")).toHaveLength(1);
  });

  it('cliente já gastou parte do crédito: recusa devolver mais que o saldo', async () => {
    const { pool, query } = fakePool({ ...CREDITADO, saldo: '40.00' });
    await expect(
      new PagamentosService().registrarDevolucaoPix(pool, 'pag-1', { valor: 150, motivo: 'x', usuarioAdminId: 'adm-1' }),
    ).rejects.toThrow('já usou parte do crédito');
    expect(sqlsCom(query, 'insert into carteira_movimentos')).toHaveLength(0);
  });

  it('não devolve mais que o crédito deste pedido', async () => {
    const { pool } = fakePool({ ...CREDITADO, creditado_restante: '20.00', saldo: '500.00' });
    await expect(
      new PagamentosService().registrarDevolucaoPix(pool, 'pag-1', { valor: 50, motivo: 'x', usuarioAdminId: 'adm-1' }),
    ).rejects.toThrow('até R$ 20.00');
  });
});
