import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorCartao } from './provedor-pagamento';

/**
 * estornarCartao: lock contra estorno duplo, só estorna o que ainda não foi
 * devolvido, parcial mantém o pagamento 'pago', 360 vira 'estorno_solicitado'
 * e falha da Rede não mexe no pagamento. Pool falso casado por trecho de SQL.
 */
function fakePool(linha: Record<string, unknown> | null, over: Record<string, any> = {}) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string, _params?: unknown[]) => {
    if (sql.includes('pg_try_advisory_lock')) return over.lock ?? { rows: [{ ok: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.includes('as ja_estornado')) return { rows: linha ? [linha] : [] };
    return { rows: [], rowCount: 1 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}

function provedor(over: Partial<ProvedorCartao> = {}): ProvedorCartao {
  return {
    nome: 'erede', metodo: 'cartao', usa3ds: false,
    novaRef: jest.fn(), cobrar: jest.fn(), criarCobranca: jest.fn(), tratarWebhook: jest.fn().mockReturnValue([]),
    consultar: jest.fn().mockResolvedValue({ status: 'pago', tid: 'TID-CONSULTA', payload: {} }),
    estornar: jest.fn().mockResolvedValue({ status: 'concluido', codigo: '359', mensagem: 'ok', refundId: 'R1', payload: {} }),
    ...over,
  } as ProvedorCartao;
}

const PAGO = {
  id: 'pag-1', pedido_id: 'ped-1', status: 'pago', metodo: 'cartao', valor: '200.00', valor_pago: '200.00',
  provedor_ref: 'P000042AAAAAAAAA', provedor_tid: 'TID1', numero: 42, ja_estornado: '0',
};
const OPTS = { motivo: 'Pedido cancelado', origem: 'sistema' as const };

const sqlsCom = (query: jest.Mock, trecho: string) => query.mock.calls.filter((c) => String(c[0]).includes(trecho));

describe('PagamentosService.estornarCartao', () => {
  it('total: estorna o valor pago e marca o pagamento como estornado', async () => {
    const { pool, query, release } = fakePool(PAGO);
    const prov = provedor();
    const r = await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(r.status).toBe('concluido');
    expect(prov.estornar).toHaveBeenCalledWith('TID1', 200);
    const up = sqlsCom(query, 'update pagamentos set status');
    expect(up[0][1]).toEqual(['pag-1', 'estornado']);
    expect(sqlsCom(query, 'insert into pagamento_estornos')).toHaveLength(1);
    expect(sqlsCom(query, 'insert into pedido_eventos')).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('parcial: estorna só a diferença e o pagamento continua pago', async () => {
    const { pool, query } = fakePool(PAGO);
    const prov = provedor();
    await new PagamentosService().estornarCartao(pool, prov, 'pag-1', { ...OPTS, valor: 35.5 });
    expect(prov.estornar).toHaveBeenCalledWith('TID1', 35.5);
    expect(sqlsCom(query, 'update pagamentos set status')[0][1]).toEqual(['pag-1', 'pago']);
  });

  it('já estornado em parte: sem valor, devolve só o que falta', async () => {
    const { pool } = fakePool({ ...PAGO, ja_estornado: '50.00' });
    const prov = provedor();
    await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(prov.estornar).toHaveBeenCalledWith('TID1', 150);
  });

  it('valor maior que o disponível: recusa sem chamar a Rede', async () => {
    const { pool } = fakePool({ ...PAGO, ja_estornado: '150.00' });
    const prov = provedor();
    const r = await new PagamentosService().estornarCartao(pool, prov, 'pag-1', { ...OPTS, valor: 60 });
    expect(r.status).toBe('falhou');
    expect(prov.estornar).not.toHaveBeenCalled();
  });

  it('pagamento já estornado: nada a estornar', async () => {
    const { pool } = fakePool({ ...PAGO, status: 'estornado' });
    const prov = provedor();
    const r = await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(r.status).toBe('nada_a_estornar');
    expect(prov.estornar).not.toHaveBeenCalled();
  });

  it('lock ocupado (clique duplo / worker ao mesmo tempo): não chama a Rede', async () => {
    const { pool } = fakePool(PAGO, { lock: { rows: [{ ok: false }] } });
    const prov = provedor();
    const r = await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(r.status).toBe('processando');
    expect(prov.estornar).not.toHaveBeenCalled();
  });

  it('pagamento antigo sem tid: recupera pela consulta por reference e grava', async () => {
    const { pool, query } = fakePool({ ...PAGO, provedor_tid: null });
    const prov = provedor();
    await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(prov.consultar).toHaveBeenCalledWith('P000042AAAAAAAAA');
    expect(prov.estornar).toHaveBeenCalledWith('TID-CONSULTA', 200);
    expect(sqlsCom(query, 'set provedor_tid')).toHaveLength(1);
  });

  it('360 (D+1): pagamento fica estorno_solicitado', async () => {
    const { pool, query } = fakePool(PAGO);
    const prov = provedor({
      estornar: jest.fn().mockResolvedValue({ status: 'solicitado', codigo: '360', mensagem: 'ok', payload: {} }),
    });
    await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(sqlsCom(query, 'update pagamentos set status')[0][1]).toEqual(['pag-1', 'estorno_solicitado']);
  });

  it('Rede recusa: grava a tentativa mas não mexe no pagamento nem na linha do tempo', async () => {
    const { pool, query } = fakePool(PAGO);
    const prov = provedor({
      estornar: jest.fn().mockResolvedValue({ status: 'falhou', codigo: '354', mensagem: 'Prazo', tentarDeNovo: false, payload: {} }),
    });
    const r = await new PagamentosService().estornarCartao(pool, prov, 'pag-1', OPTS);
    expect(r.status).toBe('falhou');
    expect(sqlsCom(query, 'insert into pagamento_estornos')[0][1]).toEqual(expect.arrayContaining(['falhou', '354', false]));
    expect(sqlsCom(query, 'update pagamentos set status')).toHaveLength(0);
    expect(sqlsCom(query, 'insert into pedido_eventos')).toHaveLength(0);
  });
});
