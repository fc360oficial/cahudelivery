import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorCartao } from './provedor-pagamento';

/**
 * pagarComCartao: lock contra clique duplo, referência nova por tentativa,
 * recusa não encerra o pagamento e tentativa anterior aprovada não é cobrada
 * de novo. Pool falso casado por trecho de SQL (padrão de orders.pix.spec.ts).
 */
function fakePool(over: Record<string, any> = {}) {
  const release = jest.fn();
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('pg_try_advisory_lock')) return over.lock ?? { rows: [{ ok: true }] };
    if (sql.includes('pg_advisory_unlock')) return { rows: [] };
    if (sql.includes('select provedor_ref, status, autenticacao_3ds'))
      return over.atual ?? { rows: [{ provedor_ref: null, status: 'pendente' }] };
    if (sql.includes('update pagamentos set provedor_ref')) return over.upRef ?? { rowCount: 1, rows: [] };
    if (sql.includes('update pagamentos set payload_json')) return { rowCount: 1, rows: [] };
    if (sql.includes('select status from pagamentos')) return over.statusFinal ?? { rows: [{ status: 'pago' }] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release }) } as unknown as Pool;
  return { pool, query, release };
}

function provedorCartao(over: Partial<ProvedorCartao> = {}): ProvedorCartao {
  return {
    nome: 'erede',
    metodo: 'cartao',
    novaRef: jest.fn().mockReturnValue('P000042NOVAREF00'),
    cobrar: jest.fn().mockResolvedValue({ aprovado: true, ref: 'P000042NOVAREF00', codigo: '00', mensagem: 'ok', payload: {} }),
    consultar: jest.fn().mockResolvedValue({ status: 'pendente', payload: {} }),
    criarCobranca: jest.fn(),
    tratarWebhook: jest.fn().mockReturnValue([]),
    ...over,
  } as ProvedorCartao;
}

const PAGAMENTO = { id: 'pag-1', numero: 42, valor: 150.5, expira_em: new Date(Date.now() + 10 * 60 * 1000) };
const CARTAO = { numero: '5448280000000007', nome: 'JOAO', validadeMes: 12, validadeAno: 2028, cvv: '123' };

describe('PagamentosService.pagarComCartao', () => {
  it('aprovado: grava ref nova, cobra e confirma o pagamento', async () => {
    const svc = new PagamentosService();
    const confirmar = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool, query, release } = fakePool();
    const prov = provedorCartao();

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r.status).toBe('pago');
    expect(prov.cobrar).toHaveBeenCalledWith('P000042NOVAREF00', 150.5, CARTAO, undefined);
    expect(confirmar).toHaveBeenCalledWith(pool, 'pag-1', 150.5, expect.any(Date), 'Cartão aprovado', expect.any(Object));
    const upRef = query.mock.calls.find((c) => (c[0] as string).includes('update pagamentos set provedor_ref'));
    expect(upRef![1]).toEqual(['pag-1', 'P000042NOVAREF00']);
    expect(release).toHaveBeenCalled(); // lock sempre devolvido
  });

  it('recusado: devolve código e mensagem, não confirma, pagamento segue pendente', async () => {
    const svc = new PagamentosService();
    const confirmar = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool, query } = fakePool();
    const prov = provedorCartao({
      cobrar: jest.fn().mockResolvedValue({
        aprovado: false, ref: 'P000042NOVAREF00', codigo: '111',
        mensagem: 'Cartão sem limite disponível. Tente outro cartão.', payload: { returnCode: '111' },
      }),
    });

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r).toEqual({ status: 'recusado', codigo: '111', mensagem: 'Cartão sem limite disponível. Tente outro cartão.' });
    expect(confirmar).not.toHaveBeenCalled();
    // resposta crua auditável no payload_json
    expect(query.mock.calls.some((c) => (c[0] as string).includes('update pagamentos set payload_json'))).toBe(true);
  });

  it('lock ocupado (clique duplo): devolve processando sem cobrar', async () => {
    const svc = new PagamentosService();
    const { pool } = fakePool({ lock: { rows: [{ ok: false }] } });
    const prov = provedorCartao();

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r.status).toBe('processando');
    expect(prov.cobrar).not.toHaveBeenCalled();
  });

  it('janela vencida: expira e devolve expirado sem cobrar', async () => {
    const svc = new PagamentosService();
    const expirar = jest.spyOn(svc, 'expirar').mockResolvedValue(true);
    const { pool } = fakePool();
    const prov = provedorCartao();

    const r = await svc.pagarComCartao(pool, prov, { ...PAGAMENTO, expira_em: new Date(Date.now() - 1000) }, CARTAO);

    expect(r.status).toBe('expirado');
    expect(expirar).toHaveBeenCalledWith(pool, 'pag-1', 'Pagamento com cartão expirado');
    expect(prov.cobrar).not.toHaveBeenCalled();
  });

  it('tentativa anterior aprovada no provedor (timeout nosso): confirma sem cobrar de novo', async () => {
    const svc = new PagamentosService();
    const confirmar = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool } = fakePool({ atual: { rows: [{ provedor_ref: 'P000042ANTERIOR0', status: 'pendente' }] } });
    const prov = provedorCartao({
      consultar: jest.fn().mockResolvedValue({ status: 'pago', valorPago: 150.5, pagoEm: new Date('2026-10-06T10:00:00Z'), payload: {} }),
    });

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r.status).toBe('pago');
    expect(prov.consultar).toHaveBeenCalledWith('P000042ANTERIOR0');
    expect(prov.cobrar).not.toHaveBeenCalled();
    expect(confirmar).toHaveBeenCalled();
  });

  const DESAFIO_ABERTO = {
    provedor_ref: 'P000042DESAFIO0', status: 'pendente', autenticacao_3ds: '220',
    url_3ds: 'https://mpi.rede/auth?token=x', desafio_recente: true,
  };

  it('3DS: desafio anterior ainda aberto reabre o mesmo desafio em vez de cobrar de novo', async () => {
    const svc = new PagamentosService();
    const { pool } = fakePool({ atual: { rows: [DESAFIO_ABERTO] } });
    const prov = provedorCartao();

    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);

    expect(r).toEqual(expect.objectContaining({ status: 'autenticar', urlAutenticacao: 'https://mpi.rede/auth?token=x' }));
    expect(prov.cobrar).not.toHaveBeenCalled();
  });

  it('3DS: desafio anterior negado ou velho libera nova tentativa', async () => {
    const svc = new PagamentosService();
    jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const negado = provedorCartao({ consultar: jest.fn().mockResolvedValue({ status: 'pendente', negada: true, payload: {} }) });
    await svc.pagarComCartao(fakePool({ atual: { rows: [DESAFIO_ABERTO] } }).pool, negado, PAGAMENTO, CARTAO);
    expect(negado.cobrar).toHaveBeenCalled();

    const velho = provedorCartao();
    await svc.pagarComCartao(fakePool({ atual: { rows: [{ ...DESAFIO_ABERTO, desafio_recente: false }] } }).pool, velho, PAGAMENTO, CARTAO);
    expect(velho.cobrar).toHaveBeenCalled();
  });

  it('3DS: cobrar pediu desafio → status autenticar com a URL do banco', async () => {
    const svc = new PagamentosService();
    const { pool } = fakePool();
    const prov = provedorCartao({
      cobrar: jest.fn().mockResolvedValue({
        aprovado: false, ref: 'P000042NOVAREF00', codigo: '220', codigo3ds: '220', mensagem: 'Confirme',
        urlAutenticacao: 'https://mpi.rede/auth?token=y', payload: {},
      }),
    });
    const r = await svc.pagarComCartao(pool, prov, PAGAMENTO, CARTAO);
    expect(r.status).toBe('autenticar');
    expect(r.urlAutenticacao).toBe('https://mpi.rede/auth?token=y');
  });
});
