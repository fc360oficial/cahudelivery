import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorCartao } from './provedor-pagamento';

/**
 * pagarComCartao segura uma conexão (com a trava de sessão pg_try_advisory_lock) durante a
 * chamada ao provedor. A confirmação do pagamento aprovado precisa rodar NESSA conexão, numa
 * transação explícita: pegar uma segunda conexão do mesmo pool travava tudo com ~10 aprovações
 * ao mesmo tempo (cartão cobrado e cliente avisado de falha até o worker reconciliar).
 * Mesmo padrão de orders/orders.conexao-unica.spec.ts.
 */

type Falha = { sql: string; erro?: Error };

/** Respostas do banco falso, casadas por trecho de SQL. */
const SEM_TENTATIVA = { provedor_ref: null, status: 'pendente', captura: 'automatica' };

function responder(sql: string, falhas: Falha[] = [], atual: Record<string, unknown> = SEM_TENTATIVA) {
  const falha = falhas.find((f) => sql.includes(f.sql));
  if (falha) throw falha.erro ?? new Error(`falha em ${falha.sql}`);
  if (sql === 'begin' || sql === 'commit' || sql === 'rollback') return { rows: [], rowCount: 0 };
  if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: true }] };
  if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
  if (sql.includes('select provedor_ref, status, autenticacao_3ds')) return { rows: [atual] };
  if (sql.includes('update pagamentos set provedor_ref')) return { rowCount: 1, rows: [] };
  if (sql.includes('update pagamentos set payload_json')) return { rowCount: 1, rows: [] };
  if (sql.includes(`update pagamentos set status = 'pago'`)) return { rowCount: 1, rows: [{ pedido_id: 'ped-1' }] };
  if (sql.includes(`update pedidos set status = 'RECEBIDO'`)) return { rowCount: 1, rows: [] };
  return { rows: [], rowCount: 1 };
}

/** Pool falso que registra qualquer pool.query/pool.connect enquanto a conexão está emprestada. */
function poolVigiado(falhas: Falha[] = [], atual?: Record<string, unknown>) {
  let emprestada = false;
  const noPoolComClienteEmprestado: string[] = [];
  const noCliente: string[] = [];
  const release = jest.fn((_erro?: Error) => {
    emprestada = false;
  });
  const cliente = {
    release,
    query: jest.fn(async (sql: string) => {
      noCliente.push(sql.replace(/\s+/g, ' ').trim());
      return responder(sql, falhas, atual);
    }),
  };
  const connect = jest.fn(async () => {
    if (emprestada) noPoolComClienteEmprestado.push('connect');
    emprestada = true;
    return cliente;
  });
  const pool = {
    query: jest.fn(async (sql: string) => {
      if (emprestada) noPoolComClienteEmprestado.push(sql.replace(/\s+/g, ' ').trim().slice(0, 80));
      return responder(sql, falhas, atual);
    }),
    connect,
  } as unknown as Pool;
  return { pool, connect, noPoolComClienteEmprestado, noCliente, release };
}

/** Pool de UMA conexão com fila, como o node-postgres: quem pede com ela emprestada espera. */
function poolDeUmaConexao() {
  let livre = true;
  const fila: Array<() => void> = [];
  const pegar = () =>
    new Promise<void>((ok) => {
      if (livre) {
        livre = false;
        ok();
      } else fila.push(ok);
    });
  const devolver = () => {
    const proximo = fila.shift();
    if (proximo) proximo();
    else livre = true;
  };
  const pool = {
    query: async (sql: string) => {
      await pegar();
      try {
        return responder(sql);
      } finally {
        devolver();
      }
    },
    connect: async () => {
      await pegar();
      return { release: devolver, query: async (sql: string) => responder(sql) };
    },
  } as unknown as Pool;
  return { pool };
}

function provedorCartao(over: Partial<ProvedorCartao> = {}): ProvedorCartao {
  return {
    nome: 'erede',
    metodo: 'cartao',
    novaRef: jest.fn().mockReturnValue('P000042NOVAREF00'),
    cobrar: jest.fn().mockResolvedValue({ aprovado: true, ref: 'P000042NOVAREF00', codigo: '00', mensagem: 'ok', tid: 'TID1', payload: {} }),
    consultar: jest.fn().mockResolvedValue({ status: 'pendente', payload: {} }),
    criarCobranca: jest.fn(),
    tratarWebhook: jest.fn().mockReturnValue([]),
    ...over,
  } as ProvedorCartao;
}

const PAGAMENTO = { id: 'pag-1', numero: 42, valor: 150.5, expira_em: new Date(Date.now() + 10 * 60 * 1000) };
const CARTAO = { numero: '5448280000000007', nome: 'JOAO', validadeMes: 12, validadeAno: 2028, cvv: '123' };

const posicao = (lista: string[], trecho: string) => lista.findIndex((s) => s.includes(trecho));

describe('PagamentosService.pagarComCartao — uma conexão só (a que segura a trava)', () => {
  it('aprovado agora: confirma na mesma conexão, em begin/commit, depois do provedor; solta a trava e devolve a conexão', async () => {
    const { pool, connect, noPoolComClienteEmprestado, noCliente, release } = poolVigiado();
    const prov = provedorCartao({
      cobrar: jest.fn(async () => {
        noCliente.push('COBRAR (HTTP do provedor)');
        return { aprovado: true, ref: 'P000042NOVAREF00', codigo: '00', mensagem: 'ok', tid: 'TID1', payload: {} };
      }),
    });
    const svc = new PagamentosService();

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r).toEqual({ status: 'pago' });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(noPoolComClienteEmprestado).toEqual([]);
    // A cobrança (HTTP externo) acontece antes e fora da transação de confirmação.
    const ordem = ['pg_try_advisory_lock', 'COBRAR (HTTP do provedor)', 'update pagamentos set payload_json', 'begin', `update pagamentos set status = 'pago'`,
      `update pedidos set status = 'RECEBIDO'`, 'insert into pedido_eventos', 'insert into sync_outbox', 'commit', 'pg_advisory_unlock']
      .map((t) => posicao(noCliente, t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(noCliente).not.toContain('rollback');
    expect(noCliente.filter((s) => s === 'begin')).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeUndefined();
  });

  it('tentativa anterior aprovada no provedor: confirma na mesma conexão, sem cobrar de novo', async () => {
    const anterior = { provedor_ref: 'P000042ANTERIOR0', status: 'pendente', captura: 'automatica' };
    const { pool, connect, noPoolComClienteEmprestado, noCliente, release } = poolVigiado([], anterior);
    const prov = provedorCartao({
      consultar: jest.fn().mockResolvedValue({ status: 'pago', valorPago: 150.5, pagoEm: new Date('2026-10-06T10:00:00Z'), tid: 'T', payload: {} }),
    });
    const svc = new PagamentosService();

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r).toEqual({ status: 'pago' });
    expect(prov.cobrar).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(noPoolComClienteEmprestado).toEqual([]);
    const begin = posicao(noCliente, 'begin');
    const pago = posicao(noCliente, `update pagamentos set status = 'pago'`);
    const commit = noCliente.lastIndexOf('commit');
    expect(begin).toBeGreaterThan(-1);
    expect(pago).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(pago);
    expect(posicao(noCliente, 'pg_advisory_unlock')).toBeGreaterThan(commit);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('erro no meio da confirmação: rollback, a trava é solta, a conexão é devolvida e o erro sobe', async () => {
    const { pool, noPoolComClienteEmprestado, noCliente, release } = poolVigiado([{ sql: 'insert into sync_outbox' }]);
    const svc = new PagamentosService();

    await expect(svc.pagarComCartao(pool, provedorCartao(), PAGAMENTO, CARTAO)).rejects.toThrow('falha em insert into sync_outbox');

    expect(noPoolComClienteEmprestado).toEqual([]);
    expect(noCliente).toContain('rollback');
    expect(noCliente).not.toContain('commit');
    expect(posicao(noCliente, 'pg_advisory_unlock')).toBeGreaterThan(noCliente.indexOf('rollback'));
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBeUndefined(); // rollback deu certo: conexão volta sã ao pool
  });

  it('erro na confirmação e o rollback também falha: a conexão é descartada (trava e transação não voltam ao pool)', async () => {
    const quebrou = new Error('conexão caiu');
    const { pool, release } = poolVigiado([{ sql: 'insert into pedido_eventos' }, { sql: 'rollback', erro: quebrou }]);
    const svc = new PagamentosService();

    await expect(svc.pagarComCartao(pool, provedorCartao(), PAGAMENTO, CARTAO)).rejects.toThrow('falha em insert into pedido_eventos');

    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toBe(quebrou);
  });

  it('termina num pool de uma conexão só (antes esperava a si mesmo até o tempo limite)', async () => {
    const { pool } = poolDeUmaConexao();
    const svc = new PagamentosService();
    const pagamento = svc.pagarComCartao(pool, provedorCartao(), PAGAMENTO, CARTAO);
    let timer: NodeJS.Timeout | undefined;
    const travou = new Promise<'travou'>((ok) => {
      timer = setTimeout(() => ok('travou'), 1000);
    });
    const r = await Promise.race([pagamento, travou]);
    clearTimeout(timer);
    expect(r).toEqual({ status: 'pago' });
  });
});
