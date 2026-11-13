import { describe, expect, it } from 'vitest';
import { formasDePagamento, saldoAplicado } from './formas';

const codigos = (l: { codigo: string }[]) => l.map((f) => f.codigo);

describe('formasDePagamento (mesma regra do checkout do app)', () => {
  it('só as formas que a retaguarda ligou, na ordem PIX, cartão, boleto', () => {
    expect(codigos(formasDePagamento({ formasPagamento: ['boleto', 'pix'], cartaoOnline: false }))).toEqual(['pix', 'boleto']);
    expect(codigos(formasDePagamento({ formasPagamento: ['cartao', 'boleto', 'pix'], cartaoOnline: false }))).toEqual(['pix', 'cartao', 'boleto']);
  });

  it('forma desconhecida é ignorada; nenhuma conhecida = só PIX', () => {
    expect(codigos(formasDePagamento({ formasPagamento: ['dinheiro'], cartaoOnline: false }))).toEqual(['pix']);
    expect(codigos(formasDePagamento({ formasPagamento: [], cartaoOnline: false }))).toEqual(['pix']);
  });

  it('cartão: na entrega (maquininha) ou online, conforme cartao_online', () => {
    const naEntrega = formasDePagamento({ formasPagamento: ['cartao'], cartaoOnline: false })[0];
    expect(naEntrega).toMatchObject({ codigo: 'cartao', titulo: 'Cartão na entrega', online: false });
    const online = formasDePagamento({ formasPagamento: ['cartao'], cartaoOnline: true })[0];
    expect(online).toMatchObject({ codigo: 'cartao', titulo: 'Cartão de crédito', online: true });
  });

  it('PIX é online; boleto não', () => {
    const l = formasDePagamento({ formasPagamento: ['pix', 'boleto'], cartaoOnline: false });
    expect(l.map((f) => f.online)).toEqual([true, false]);
  });
});

describe('saldoAplicado (usarSaldo: abate o menor entre saldo e subtotal)', () => {
  it('sem usar o saldo nada muda', () => {
    expect(saldoAplicado({ saldo: 30, subtotal: 100, usar: false })).toEqual({ aplicado: 0, restante: 100 });
  });
  it('saldo menor que o subtotal abate tudo', () => {
    expect(saldoAplicado({ saldo: 30, subtotal: 100, usar: true })).toEqual({ aplicado: 30, restante: 70 });
  });
  it('saldo maior que o subtotal abate só o subtotal', () => {
    expect(saldoAplicado({ saldo: 150, subtotal: 100, usar: true })).toEqual({ aplicado: 100, restante: 0 });
  });
  it('centavos exatos e saldo negativo/inválido não abatem', () => {
    expect(saldoAplicado({ saldo: 0.1, subtotal: 0.3, usar: true })).toEqual({ aplicado: 0.1, restante: 0.2 });
    expect(saldoAplicado({ saldo: -5, subtotal: 100, usar: true })).toEqual({ aplicado: 0, restante: 100 });
    expect(saldoAplicado({ saldo: Number.NaN, subtotal: 100, usar: true })).toEqual({ aplicado: 0, restante: 100 });
  });
});
