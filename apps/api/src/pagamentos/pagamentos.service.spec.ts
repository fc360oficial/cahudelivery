import type { Pool, PoolClient } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';

function fakePool(respostas: Array<{ rows?: any[]; rowCount?: number }>) {
  const query = jest.fn();
  respostas.forEach((r) => query.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) }));
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  return { pool: { query } as unknown as Pool, query };
}

describe('PagamentosService', () => {
  const svc = new PagamentosService();

  it('gerarRef: 26 a 35 caracteres alfanuméricos com o número do pedido', () => {
    const ref = svc.gerarRef(123);
    expect(ref).toMatch(/^[A-Za-z0-9]{26,35}$/);
    expect(ref.startsWith('PED000123')).toBe(true);
  });

  it('criarParaPedido: chama o provedor e grava a linha em pagamentos', async () => {
    const { pool, query } = fakePool([{ rows: [{ id: 'pag-1' }] }]);
    const prov = new MockProvedor();
    const r = await svc.criarParaPedido(pool as unknown as PoolClient, prov, {
      pedidoId: 'ped-1', numero: 7, valor: 99.9, expiracaoSegundos: 1800, appNome: 'CAHU Delivery',
    });
    expect(r.id).toBe('pag-1');
    expect(r.status).toBe('pendente');
    expect(r.copiaCola).toMatch(/^MOCKPIX-PED000007/);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('insert into pagamentos');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['ped-1', 'mock', 'pix', 99.9]));
  });

  it('confirmarPago: só transiciona se ainda pendente, e move o pedido pra RECEBIDO', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 }, // update pagamentos ... returning pedido_id
    ]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date('2026-09-25T14:32:00Z'));
    expect(ok).toBe(true);
    expect(query.mock.calls[0][0]).toContain("status = 'pendente'");
    expect(query.mock.calls[1][0]).toContain("set status = 'RECEBIDO'");
    expect(query.mock.calls[2][0]).toContain('insert into pedido_eventos');
    expect(query.mock.calls[2][1]).toEqual(['ped-1', 'RECEBIDO', 'PIX pago']);
  });

  it('confirmarPago repetido: não gera evento duplicado', async () => {
    const { pool, query } = fakePool([{ rows: [], rowCount: 0 }]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date());
    expect(ok).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('expirar: cancela o pedido e estorna o saldo usado', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 },
      { rows: [{ cliente_id: 'cli-1', valor_saldo_usado: '15.00', numero: 7 }] },
    ]);
    const ok = await svc.expirar(pool, 'pag-1');
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("set status = 'CANCELADO'"))).toBe(true);
    expect(sqls.some((s) => s.includes('insert into carteira_movimentos'))).toBe(true);
    const estorno = query.mock.calls.find((c) => (c[0] as string).includes('carteira_movimentos'));
    expect(estorno![1]).toEqual(['cli-1', 15, 'Estorno: PIX expirado (pedido #7)', 'ped-1']);
  });

  it('aplicarSituacao: pendente vencido vira expirado; pago confirma', async () => {
    const exp = jest.spyOn(svc, 'expirar').mockResolvedValue(true);
    const pago = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool } = fakePool([]);
    await svc.aplicarSituacao(pool, { id: 'p1', expira_em: new Date(Date.now() - 1000) }, { status: 'pendente', payload: {} });
    expect(exp).toHaveBeenCalledWith(pool, 'p1');
    await svc.aplicarSituacao(pool, { id: 'p2', expira_em: new Date(Date.now() + 1000) }, { status: 'pendente', payload: {} });
    expect(exp).toHaveBeenCalledTimes(1);
    await svc.aplicarSituacao(pool, { id: 'p3', expira_em: new Date() }, { status: 'pago', valorPago: 5, pagoEm: new Date(), payload: {} });
    expect(pago).toHaveBeenCalledWith(pool, 'p3', 5, expect.any(Date));
    exp.mockRestore(); pago.mockRestore();
  });
});
