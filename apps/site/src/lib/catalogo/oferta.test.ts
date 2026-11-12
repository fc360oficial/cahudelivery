import { describe, expect, it } from 'vitest';
import type { Produto } from '@/lib/api/tipos';
import { emOferta } from './oferta';

const produto = (extra: Partial<Produto> = {}): Produto => ({
  id: '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295', sku: null, ean: null, nome: 'Detergente', descricao: null,
  unidadeVenda: 'CX', qtdPorEmbalagem: 24, qtdMinima: 1, descontoQtdMinima: null, descontoQtdPreco: null,
  dataValidade: null, marca: null, marcaId: null, categoria: 'Limpeza', categoriaId: 'c1', estoque: 100,
  precoTabela: 52.8, precoPromocional: null, preco: 52.8, imagens: [], ...extra,
});

describe('emOferta', () => {
  it('promoção com preço de tabela maior que o preço efetivo', () => {
    expect(emOferta(produto({ precoTabela: 79.9, precoPromocional: 59.9, preco: 59.9 }))).toBe(true);
  });
  it('sem promoção não é oferta', () => {
    expect(emOferta(produto())).toBe(false);
  });
  it('sem preço de tabela não é oferta', () => {
    expect(emOferta(produto({ precoTabela: null, precoPromocional: 59.9, preco: 59.9 }))).toBe(false);
  });
  it('promoção que não baixa o preço não é oferta', () => {
    expect(emOferta(produto({ precoTabela: 50, precoPromocional: 50, preco: 50 }))).toBe(false);
  });
});
