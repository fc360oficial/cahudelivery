import { describe, expect, it } from 'vitest';
import { deveConsultar, intervaloConsulta, telaDoPagamento, tempoRestante } from './estado-pagamento';

const AGORA = Date.parse('2026-11-13T15:00:00Z');
const daqui = (s: number) => new Date(AGORA + s * 1000).toISOString();
const pix = (status: string, extra: Record<string, unknown> = {}) => ({
  status: 'AGUARDANDO_PAGAMENTO', formaPagamento: 'pix',
  pagamento: { metodo: 'pix', status, valor: 120.5, expiraEm: daqui(600), pagoEm: null, copiaCola: '000201...', ...extra },
});

describe('telaDoPagamento (o que o bloco de pagamento mostra; mesmos estados do BlocoPix do app)', () => {
  it('pedido sem pagamento online: nada a mostrar', () => {
    expect(telaDoPagamento({ status: 'RECEBIDO', formaPagamento: 'pix', pagamento: null }, AGORA)).toEqual({ tipo: 'nenhum' });
  });

  it('PIX pendente com código: QR, copia-e-cola, valor e prazo', () => {
    expect(telaDoPagamento(pix('pendente'), AGORA)).toEqual({ tipo: 'pix', copiaCola: '000201...', valor: 120.5, expiraEm: daqui(600) });
  });

  it('PIX pendente ainda sem código: gerando', () => {
    expect(telaDoPagamento(pix('pendente', { copiaCola: null }), AGORA)).toEqual({ tipo: 'pix-gerando' });
  });

  it('PIX pendente com o prazo vencido no relógio: prazo encerrado (sem QR para pagar)', () => {
    expect(telaDoPagamento(pix('pendente', { expiraEm: daqui(-1) }), AGORA)).toEqual({ tipo: 'prazo-encerrado', metodo: 'pix' });
  });

  it('pago ou autorizado = confirmado; o resto vira o estado final certo', () => {
    expect(telaDoPagamento(pix('pago', { pagoEm: daqui(-5) }), AGORA)).toEqual({ tipo: 'pago', metodo: 'pix', pagoEm: daqui(-5) });
    expect(telaDoPagamento({ ...pix('autorizado'), formaPagamento: 'cartao', pagamento: { ...pix('autorizado').pagamento, metodo: 'cartao' } }, AGORA))
      .toEqual({ tipo: 'reservado', valor: 120.5 });
    expect(telaDoPagamento(pix('expirado'), AGORA)).toEqual({ tipo: 'expirado', metodo: 'pix' });
    expect(telaDoPagamento(pix('cancelado'), AGORA)).toEqual({ tipo: 'cancelado', metodo: 'pix' });
    expect(telaDoPagamento(pix('falhou'), AGORA)).toEqual({ tipo: 'falhou', metodo: 'pix' });
    expect(telaDoPagamento(pix('estorno_solicitado'), AGORA)).toEqual({ tipo: 'estorno-solicitado', valor: 120.5 });
    expect(telaDoPagamento(pix('estornado'), AGORA)).toEqual({ tipo: 'estornado', metodo: 'pix' });
    expect(telaDoPagamento(pix('creditado'), AGORA)).toEqual({ tipo: 'creditado' });
  });

  it('status que não conhecemos nunca vira "pago" nem "expirado": indisponível', () => {
    expect(telaDoPagamento(pix('qualquer'), AGORA)).toEqual({ tipo: 'indisponivel' });
    expect(telaDoPagamento(pix(''), AGORA)).toEqual({ tipo: 'indisponivel' });
  });

  it('cartão pendente: formulário do cartão com o valor', () => {
    const p = { status: 'AGUARDANDO_PAGAMENTO', formaPagamento: 'cartao', pagamento: { metodo: 'cartao', status: 'pendente', valor: 99, expiraEm: daqui(600), pagoEm: null, copiaCola: null } };
    expect(telaDoPagamento(p, AGORA)).toEqual({ tipo: 'cartao', valor: 99, expiraEm: daqui(600) });
    expect(telaDoPagamento({ ...p, pagamento: { ...p.pagamento, expiraEm: daqui(-1) } }, AGORA)).toEqual({ tipo: 'prazo-encerrado', metodo: 'cartao' });
  });

  it('pagamento pendente de pedido que já saiu de AGUARDANDO_PAGAMENTO não pede pagamento', () => {
    expect(telaDoPagamento({ ...pix('pendente'), status: 'CANCELADO' }, AGORA)).toEqual({ tipo: 'indisponivel' });
  });
});

describe('deveConsultar (consulta periódica do pedido)', () => {
  it('só enquanto espera pagamento e com a aba visível', () => {
    expect(deveConsultar({ tipo: 'pix', copiaCola: 'x', valor: 1, expiraEm: null }, true)).toBe(true);
    expect(deveConsultar({ tipo: 'pix-gerando' }, true)).toBe(true);
    expect(deveConsultar({ tipo: 'cartao', valor: 1, expiraEm: null }, true)).toBe(true);
    expect(deveConsultar({ tipo: 'pix', copiaCola: 'x', valor: 1, expiraEm: null }, false)).toBe(false);
    for (const tipo of ['pago', 'expirado', 'cancelado', 'nenhum', 'indisponivel', 'creditado'] as const) {
      expect(deveConsultar({ tipo } as never, true), tipo).toBe(false);
    }
  });

  it('prazo encerrado no relógio continua consultando (a API ainda vai marcar expirado ou pago)', () => {
    expect(deveConsultar({ tipo: 'prazo-encerrado', metodo: 'pix' }, true)).toBe(true);
  });
});

describe('intervaloConsulta', () => {
  it('5 s normal; recua em falha (10, 20, 40) até 60 s', () => {
    expect([0, 1, 2, 3, 4, 10].map(intervaloConsulta)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });
});

describe('tempoRestante', () => {
  it('mm:ss até o fim; zero quando passou; nulo sem prazo', () => {
    expect(tempoRestante(daqui(605), AGORA)).toBe('10:05');
    expect(tempoRestante(daqui(59), AGORA)).toBe('00:59');
    expect(tempoRestante(daqui(-3), AGORA)).toBe('00:00');
    expect(tempoRestante(daqui(3 * 3600 + 5), AGORA)).toBe('180:05');
    expect(tempoRestante(null, AGORA)).toBeNull();
    expect(tempoRestante('lixo', AGORA)).toBeNull();
  });
});
