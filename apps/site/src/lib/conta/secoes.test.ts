import { describe, expect, it } from 'vitest';
import { SECOES_MENU, secaoAtual } from './secoes';

describe('menu da conta', () => {
  it('ordem do menu do nome: pedidos, notas, dados, endereços, crédito, carteira', () => {
    expect(SECOES_MENU.map((s) => s.rotulo)).toEqual([
      'Meus pedidos', 'Notas fiscais', 'Dados cadastrais', 'Endereços', 'Crédito', 'Carteira',
    ]);
    expect(SECOES_MENU.every((s) => s.caminho.startsWith('/conta/'))).toBe(true);
  });
});

describe('secaoAtual', () => {
  it('acha a seção pelo caminho, inclusive em subpáginas', () => {
    expect(secaoAtual('/conta')?.rotulo).toBe('Visão geral');
    expect(secaoAtual('/conta/pedidos')?.rotulo).toBe('Meus pedidos');
    expect(secaoAtual('/conta/pedidos/9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295')?.rotulo).toBe('Meus pedidos');
    expect(secaoAtual('/conta/enderecos')?.rotulo).toBe('Endereços');
  });
  it('não confunde prefixo parecido', () => {
    expect(secaoAtual('/conta/pedidosx')).toBeNull();
    expect(secaoAtual('/carrinho')).toBeNull();
    expect(secaoAtual(null)).toBeNull();
  });
});
