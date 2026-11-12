import { describe, expect, it } from 'vitest';
import { precoEfetivo } from './preco-efetivo';

const base = { preco: 79.9, precoTabela: 79.9, descontoQtdMinima: 4, descontoQtdPreco: 59.9 };

describe('precoEfetivo (mesma regra do carrinho da API)', () => {
  it('abaixo da quantidade mínima vale o preço normal', () => {
    expect(precoEfetivo(base, 3)).toBe(79.9);
  });
  it('a partir da quantidade mínima vale o preço com desconto', () => {
    expect(precoEfetivo(base, 4)).toBe(59.9);
    expect(precoEfetivo(base, 10)).toBe(59.9);
  });
  it('promoção mais barata que o desconto por quantidade continua valendo', () => {
    expect(precoEfetivo({ ...base, preco: 49.9 }, 4)).toBe(49.9);
  });
  it('sem desconto por quantidade cadastrado', () => {
    expect(precoEfetivo({ ...base, descontoQtdMinima: null, descontoQtdPreco: null }, 10)).toBe(79.9);
  });
  it('sem preço de tabela não aplica o desconto (a API também não)', () => {
    expect(precoEfetivo({ ...base, preco: null, precoTabela: null }, 4)).toBeNull();
  });
});
