import { creditarIndicacao } from './creditar-indicacao';

describe('creditarIndicacao — só pedido do app do cliente credita', () => {
  it('o select filtra por origem app_cliente e, sem linha, nada é inserido', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    await creditarIndicacao({ query } as never, 'ped-1');
    expect(String((query.mock.calls[0] as unknown[])[0])).toContain("p.origem in ('app_cliente','site')");
    expect(query.mock.calls.some(([sql]) => String(sql).includes('carteira_movimentos'))).toBe(false);
  });

  it('com linha elegível credita a carteira de quem indicou', async () => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('from pedidos p')
        ? { rows: [{ indicado_id: 'c2', indicado_nome: 'Loja', indicado_por_cliente_id: 'c1' }] }
        : { rows: [] });
    await creditarIndicacao({ query } as never, 'ped-1');
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into carteira_movimentos'))).toBe(true);
  });
});
