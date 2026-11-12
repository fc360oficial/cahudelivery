import { describe, expect, it } from 'vitest';
import { validarItem } from './item';
import { origemConfere } from './origem';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';

describe('origemConfere', () => {
  it('aceita só quando o host do Origin é o host da requisição', () => {
    expect(origemConfere('https://loja.exemplo.com', 'loja.exemplo.com')).toBe(true);
    expect(origemConfere('http://localhost:3010', 'localhost:3010')).toBe(true);
    expect(origemConfere('https://outro.com', 'loja.exemplo.com')).toBe(false);
    expect(origemConfere(null, 'loja.exemplo.com')).toBe(false);
    expect(origemConfere('https://loja.exemplo.com', null)).toBe(false);
    expect(origemConfere('nao-e-url', 'loja.exemplo.com')).toBe(false);
  });
});

describe('validarItem', () => {
  it('aceita produtoId uuid e quantidade inteira de 0 a 9999', () => {
    expect(validarItem({ produtoId: ID, quantidade: 3 })).toEqual({ produtoId: ID, quantidade: 3 });
    expect(validarItem({ produtoId: ID, quantidade: 0 })).toEqual({ produtoId: ID, quantidade: 0 });
  });
  it('recusa o resto', () => {
    expect(validarItem(null)).toBeNull();
    expect(validarItem({ produtoId: 'x', quantidade: 1 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: 1.5 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: -1 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: 10000 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: '2' })).toBeNull();
  });
});
