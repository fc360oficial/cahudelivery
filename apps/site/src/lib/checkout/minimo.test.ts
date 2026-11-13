import { describe, expect, it } from 'vitest';
import { barraDoMinimo, podeFinalizar } from './minimo';

describe('barraDoMinimo', () => {
  it('sem mínimo (nulo ou zero): não há barra e libera', () => {
    expect(barraDoMinimo(50, null)).toEqual({ temMinimo: false, atingiu: true, falta: 0, progresso: 1, minimo: 0 });
    expect(barraDoMinimo(50, 0).temMinimo).toBe(false);
  });

  it('abaixo do mínimo: quanto falta e o progresso proporcional', () => {
    expect(barraDoMinimo(150, 200)).toEqual({ temMinimo: true, atingiu: false, falta: 50, progresso: 0.75, minimo: 200 });
  });

  it('falta em centavos exatos (sem resto de ponto flutuante)', () => {
    expect(barraDoMinimo(79.9, 100).falta).toBe(20.1);
    expect(barraDoMinimo(0.1 + 0.2, 1).falta).toBe(0.7);
  });

  it('igual ou acima do mínimo: atingiu, falta zero, barra cheia', () => {
    expect(barraDoMinimo(200, 200)).toMatchObject({ atingiu: true, falta: 0, progresso: 1 });
    expect(barraDoMinimo(350, 200)).toMatchObject({ atingiu: true, falta: 0, progresso: 1 });
  });

  it('subtotal inválido conta como zero', () => {
    expect(barraDoMinimo(Number.NaN, 100)).toMatchObject({ atingiu: false, falta: 100, progresso: 0 });
  });
});

describe('podeFinalizar', () => {
  it('como no app: libera só com itens, mínimo atingido e cadastro que não está pendente', () => {
    const ok = { itens: 2, atingiu: true, statusCadastro: 'aprovado' };
    expect(podeFinalizar(ok)).toEqual({ pode: true, motivo: null });
    expect(podeFinalizar({ ...ok, itens: 0 })).toEqual({ pode: false, motivo: 'vazio' });
    expect(podeFinalizar({ ...ok, atingiu: false })).toEqual({ pode: false, motivo: 'minimo' });
    expect(podeFinalizar({ ...ok, statusCadastro: 'pendente' })).toEqual({ pode: false, motivo: 'em-analise' });
  });

  it('status desconhecido ou ausente não trava (a API é a garantia final, como no app)', () => {
    expect(podeFinalizar({ itens: 1, atingiu: true, statusCadastro: null }).pode).toBe(true);
  });
});
