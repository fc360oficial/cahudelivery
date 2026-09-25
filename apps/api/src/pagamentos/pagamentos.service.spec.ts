import type { Pool, PoolClient } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';

function fakePool(respostas: Array<{ rows?: any[]; rowCount?: number }>) {
  let respostaIdx = 0;
  const query = jest.fn(async (sql: string) => {
    if (['begin', 'commit', 'rollback'].includes(sql)) {
      return { rows: [], rowCount: 0 };
    }
    const r = respostas[respostaIdx] ?? { rows: [], rowCount: 0 };
    respostaIdx++;
    return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) };
  });
  const release = jest.fn();
  return {
    pool: { query, connect: async () => ({ query, release }) } as unknown as Pool,
    query,
  };
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
      { rows: [], rowCount: 1 }, // update pedidos
    ]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date('2026-09-25T14:32:00Z'));
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string).filter((s) => !['begin', 'commit', 'rollback'].includes(s));
    expect(sqls[0]).toContain("status = 'pendente'");
    expect(sqls[1]).toContain("set status = 'RECEBIDO'");
    expect(sqls[2]).toContain('insert into pedido_eventos');
    expect(sqls.some((s) => s.includes('insert into sync_outbox'))).toBe(true);
    const eventos = query.mock.calls.find((c) => (c[0] as string).includes('insert into pedido_eventos'));
    expect(eventos![1]).toEqual(['ped-1', 'RECEBIDO', 'PIX pago']);
    // Verify transactions
    const allCalls = query.mock.calls.map((c) => c[0] as string);
    expect(allCalls[0]).toBe('begin');
    expect(allCalls[allCalls.length - 1]).toBe('commit');
  });

  it('confirmarPago repetido: não gera evento duplicado', async () => {
    const { pool, query } = fakePool([{ rows: [], rowCount: 0 }]); // update pagamentos returns 0
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date());
    expect(ok).toBe(false);
    const sqls = query.mock.calls.map((c) => c[0] as string).filter((s) => !['begin', 'commit', 'rollback'].includes(s));
    expect(sqls).toHaveLength(1);
  });

  it('expirar: cancela o pedido e estorna o saldo usado', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 }, // update pagamentos
      { rows: [{ cliente_id: 'cli-1', valor_saldo_usado: '15.00', numero: 7 }] }, // select pedido
      { rows: [], rowCount: 1 }, // update pedidos
    ]);
    const ok = await svc.expirar(pool, 'pag-1');
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string).filter((s) => !['begin', 'commit', 'rollback'].includes(s));
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
    expect(exp).toHaveBeenCalledWith(pool, 'p1', 'PIX expirado');
    await svc.aplicarSituacao(pool, { id: 'p2', expira_em: new Date(Date.now() + 1000) }, { status: 'pendente', payload: {} });
    expect(exp).toHaveBeenCalledTimes(1);
    await svc.aplicarSituacao(pool, { id: 'p3', expira_em: new Date() }, { status: 'pago', valorPago: 5, pagoEm: new Date(), payload: {} });
    expect(pago).toHaveBeenCalledWith(pool, 'p3', 5, expect.any(Date));
    exp.mockRestore(); pago.mockRestore();
  });

  it('confirmarPago: pedido que já saiu de AGUARDANDO_PAGAMENTO não ganha evento', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 }, // update pagamentos
      { rows: [], rowCount: 0 }, // update pedidos (não mudou)
    ]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date());
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string).filter((s) => !['begin', 'commit', 'rollback'].includes(s));
    expect(sqls).toHaveLength(2); // update pag + update ped (sem insert evento, sem outbox)
    expect(sqls[1]).toContain("set status = 'RECEBIDO'");
    expect(sqls.some((s) => s.includes('insert into sync_outbox'))).toBe(false);
  });

  it('aplicarSituacao: cancelado usa detalhe "PIX cancelado no banco"', async () => {
    const exp = jest.spyOn(svc, 'expirar').mockResolvedValue(true);
    const { pool } = fakePool([]);
    await svc.aplicarSituacao(pool, { id: 'p1', expira_em: new Date(Date.now() + 1000) }, { status: 'cancelado', payload: {} });
    expect(exp).toHaveBeenCalledWith(pool, 'p1', 'PIX cancelado no banco');
    exp.mockRestore();
  });

  it('confirmarPago com um PoolClient (tem connect() herdado de Client, mas tem release) não abre transação própria nem libera', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('update pagamentos')) return { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = jest.fn();
    // PoolClient real também tem connect() (herdado de Client) — é o que fazia ehPool() errar antes.
    const fakeClient = { query, release, connect: jest.fn() } as unknown as PoolClient;
    const ok = await svc.confirmarPago(fakeClient, 'pag-1', 10, new Date());
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls).not.toContain('begin');
    expect(sqls).not.toContain('commit');
    expect(release).not.toHaveBeenCalled();
  });

  it('confirmarPago: falha no meio da transação faz rollback e libera o client', async () => {
    const release = jest.fn();
    const query = jest.fn(async (sql: string) => {
      if (sql === 'begin' || sql === 'rollback' || sql === 'commit') return { rows: [], rowCount: 0 };
      if (sql.includes('update pagamentos')) return { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 };
      throw new Error('falha simulada');
    });
    const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
    await expect(svc.confirmarPago(pool, 'pag-1', 1, new Date())).rejects.toThrow('falha simulada');
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls).toContain('rollback');
    expect(sqls).not.toContain('commit');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
