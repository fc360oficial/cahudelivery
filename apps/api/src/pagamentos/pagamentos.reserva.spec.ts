import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorCartao } from './provedor-pagamento';

/**
 * Pré-autorização: cobrar a reserva pelo valor da NF-e (nunca acima do
 * reservado), conferir na Rede antes de dar falha, e liberar a reserva de
 * pedido cancelado. Pool falso casado por trecho de SQL.
 */
function fakePool(linha: Record<string, unknown> | null, over: Record<string, any> = {}) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('pg_try_advisory_lock')) return over.lock ?? { rows: [{ ok: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.includes('from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1')) return { rows: linha ? [linha] : [] };
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}

function provedor(over: Partial<ProvedorCartao> = {}): ProvedorCartao {
  return {
    nome: 'erede', metodo: 'cartao', usa3ds: false, preAutorizacao: { ativa: true, prazoHoras: 72, folgaHoras: 12 },
    novaRef: jest.fn(), cobrar: jest.fn(), criarCobranca: jest.fn(), tratarWebhook: jest.fn().mockReturnValue([]),
    consultar: jest.fn().mockResolvedValue({ status: 'pago', capturado: false, payload: {} }),
    capturar: jest.fn().mockResolvedValue({ ok: true, codigo: '00', mensagem: 'ok', payload: {} }),
    estornar: jest.fn().mockResolvedValue({ status: 'concluido', codigo: '359', mensagem: 'ok', payload: {} }),
    ...over,
  } as ProvedorCartao;
}

const RESERVA = {
  id: 'pag-1', pedido_id: 'ped-1', status: 'autorizado', valor: '100.00', provedor_ref: 'P000042AAAAAAAAA',
  provedor_tid: 'TID1', numero: 42, pedido_status: 'FATURADO', faturado: '80.00',
};
const sqlsCom = (query: jest.Mock, trecho: string) => query.mock.calls.filter((c) => String(c[0]).includes(trecho));

describe('PagamentosService.cobrarReserva', () => {
  it('pedido de 100 com nota de 80: cobra 80 e o pagamento vira pago', async () => {
    const { pool, query } = fakePool(RESERVA);
    const prov = provedor();
    const r = await new PagamentosService().cobrarReserva(pool, prov, 'pag-1', { motivo: 'valor da nota fiscal', origem: 'sistema' });
    expect(r).toEqual(expect.objectContaining({ status: 'cobrado', valor: 80 }));
    expect(prov.capturar).toHaveBeenCalledWith('TID1', 80);
    expect(sqlsCom(query, "set status = 'pago'")[0][1]).toEqual(['pag-1', 80]);
    const evento = sqlsCom(query, 'insert into pedido_eventos')[0][1] as unknown[];
    expect(String(evento[2])).toContain('R$ 20,00 da reserva não foram cobrados');
  });

  it('nota maior que a reserva: cobra só até o reservado', async () => {
    const { pool } = fakePool({ ...RESERVA, faturado: '120.00' });
    const prov = provedor();
    await new PagamentosService().cobrarReserva(pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' });
    expect(prov.capturar).toHaveBeenCalledWith('TID1', 100);
  });

  it('sem nota ainda (rede de segurança): cobra o reservado', async () => {
    const { pool } = fakePool({ ...RESERVA, pedido_status: 'ENVIADO_ERP', faturado: null });
    const prov = provedor();
    await new PagamentosService().cobrarReserva(pool, prov, 'pag-1', { motivo: 'reserva perto de vencer', origem: 'sistema' });
    expect(prov.capturar).toHaveBeenCalledWith('TID1', 100);
  });

  it('Rede respondeu mal mas cobrou: confere na consulta e marca pago', async () => {
    const { pool, query } = fakePool(RESERVA);
    const prov = provedor({
      capturar: jest.fn().mockResolvedValue({ ok: false, codigo: '', mensagem: 'timeout', tentarDeNovo: true, payload: null }),
      consultar: jest.fn().mockResolvedValue({ status: 'pago', capturado: true, valorCapturado: 80, payload: {} }),
    });
    const r = await new PagamentosService().cobrarReserva(pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' });
    expect(r.status).toBe('cobrado');
    expect(sqlsCom(query, "set status = 'pago'")).toHaveLength(1);
  });

  it('Rede recusou de verdade: guarda o erro e o pagamento segue reservado', async () => {
    const { pool, query } = fakePool(RESERVA);
    const prov = provedor({
      capturar: jest.fn().mockResolvedValue({ ok: false, codigo: '57', mensagem: 'Expired', payload: {} }),
    });
    const r = await new PagamentosService().cobrarReserva(pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' });
    expect(r.status).toBe('falhou');
    expect(sqlsCom(query, 'set captura_erro')).toHaveLength(1);
    expect(sqlsCom(query, "set status = 'pago'")).toHaveLength(0);
  });

  it('pedido cancelado não é cobrado; reserva já cobrada não cobra de novo', async () => {
    const prov = provedor();
    const svc = new PagamentosService();
    expect((await svc.cobrarReserva(fakePool({ ...RESERVA, pedido_status: 'CANCELADO' }).pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' })).status).toBe('nada');
    expect((await svc.cobrarReserva(fakePool({ ...RESERVA, status: 'pago' }).pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' })).status).toBe('nada');
    expect(prov.capturar).not.toHaveBeenCalled();
  });

  it('lock ocupado (worker e retaguarda juntos): não chama a Rede', async () => {
    const prov = provedor();
    const r = await new PagamentosService().cobrarReserva(fakePool(RESERVA, { lock: { rows: [{ ok: false }] } }).pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' });
    expect(r.status).toBe('processando');
    expect(prov.capturar).not.toHaveBeenCalled();
  });
});

describe('PagamentosService.liberarReserva', () => {
  it('pedido cancelado: cancela a autorização na Rede e o pagamento vira cancelado', async () => {
    const { pool, query } = fakePool({ ...RESERVA, pedido_status: 'CANCELADO' });
    const prov = provedor();
    const r = await new PagamentosService().liberarReserva(pool, prov, 'pag-1', { motivo: 'pedido cancelado', origem: 'sistema' });
    expect(r.status).toBe('liberado');
    expect(prov.estornar).toHaveBeenCalledWith('TID1', 100);
    expect(sqlsCom(query, "set status = 'cancelado'")).toHaveLength(1);
  });

  it('Rede recusou: guarda o erro e mantém reservado pra tentar de novo', async () => {
    const { pool, query } = fakePool(RESERVA);
    const prov = provedor({ estornar: jest.fn().mockResolvedValue({ status: 'falhou', codigo: '370', mensagem: 'falhou', tentarDeNovo: true, payload: {} }) });
    const r = await new PagamentosService().liberarReserva(pool, prov, 'pag-1', { motivo: 'x', origem: 'sistema' });
    expect(r.status).toBe('falhou');
    expect(sqlsCom(query, "set status = 'cancelado'")).toHaveLength(0);
    expect(sqlsCom(query, 'set captura_erro')).toHaveLength(1);
  });
});

describe('PagamentosService.aplicarSituacao com reserva', () => {
  it('Approved sem captura num pagamento de captura posterior vira autorizado', async () => {
    const svc = new PagamentosService();
    const conf = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool } = fakePool(null);
    await svc.aplicarSituacao(pool, { id: 'p1', expira_em: new Date(), metodo: 'cartao', captura: 'posterior' },
      { status: 'pago', capturado: false, valorPago: 100, payload: {} });
    expect(conf).toHaveBeenCalledWith(pool, 'p1', 100, expect.any(Date), expect.stringContaining('reservado'), expect.objectContaining({ soReserva: true }));
    // captura automática continua como sempre
    await svc.aplicarSituacao(pool, { id: 'p2', expira_em: new Date(), metodo: 'cartao', captura: 'automatica' },
      { status: 'pago', valorPago: 100, payload: {} });
    expect(conf).toHaveBeenLastCalledWith(pool, 'p2', 100, expect.any(Date), 'Cartão aprovado', expect.objectContaining({ soReserva: false }));
  });
});
