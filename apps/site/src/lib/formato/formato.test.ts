import { describe, expect, it } from 'vitest';
import { caminhoCategoria, caminhoProduto, idDoSegmento, slugificar } from './caminhos';
import { formatarValidade } from './datas';
import { nomeEmbalagem, rotuloEmbalagem } from './embalagem';
import { formatarPreco, percentualDesconto, precoPorUnidade } from './preco';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';

describe('preço', () => {
  it('formata em reais com espaço comum', () => {
    expect(formatarPreco(52.8)).toBe('R$ 52,80');
    expect(formatarPreco(1234.5)).toBe('R$ 1.234,50');
  });
  it('preço por unidade só quando a embalagem tem mais de uma', () => {
    expect(precoPorUnidade(52.8, 24)).toBe(2.2);
    expect(precoPorUnidade(10, 1)).toBeNull();
    expect(precoPorUnidade(10, 0)).toBeNull();
  });
  it('percentual de desconto arredondado, nulo sem desconto', () => {
    expect(percentualDesconto(79.9, 59.9)).toBe(25);
    expect(percentualDesconto(10, 10)).toBeNull();
    expect(percentualDesconto(null, 10)).toBeNull();
    expect(percentualDesconto(10, null)).toBeNull();
  });
});

describe('embalagem', () => {
  it('nomeia a unidade de venda', () => {
    expect(nomeEmbalagem('CX')).toBe('Caixa');
    expect(nomeEmbalagem('fd')).toBe('Fardo');
    expect(nomeEmbalagem('XX')).toBe('Embalagem');
  });
  it('rótulo com a quantidade quando maior que 1', () => {
    expect(rotuloEmbalagem('CX', 24)).toBe('Caixa com 24 unidades');
    expect(rotuloEmbalagem('UN', 1)).toBe('Unidade');
  });
});

describe('caminhos', () => {
  it('slug sem acento, minúsculo, com hífen', () => {
    expect(slugificar('Açúcar Cristal 1 kg')).toBe('acucar-cristal-1-kg');
    expect(slugificar('  Óleo/Soja  ')).toBe('oleo-soja');
    expect(slugificar('***')).toBe('item');
  });
  it('monta e lê o caminho do produto e da categoria', () => {
    expect(caminhoProduto({ id: ID, nome: 'Detergente Neutro 500 ml' })).toBe(`/p/detergente-neutro-500-ml-${ID}`);
    expect(caminhoCategoria({ id: ID, nome: 'Higiene e Beleza' })).toBe(`/c/higiene-e-beleza-${ID}`);
    expect(idDoSegmento(`detergente-neutro-500-ml-${ID}`)).toBe(ID);
    expect(idDoSegmento(ID.toUpperCase())).toBe(ID);
    expect(idDoSegmento('sem-id')).toBeNull();
  });
});

describe('datas', () => {
  it('validade em DD/MM', () => {
    expect(formatarValidade('2026-12-05')).toBe('05/12');
    expect(formatarValidade('2026-12-05T03:00:00.000Z')).toBe('05/12');
  });
});
