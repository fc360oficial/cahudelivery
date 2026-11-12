import { describe, expect, it } from 'vitest';
import type { Home, Patrocinador, Produto } from '@/lib/api/tipos';
import { montarSecoesHome } from './home';
import { selosDoProduto } from './selos';

export const produto = (extra: Partial<Produto> = {}): Produto => ({
  id: '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295', sku: null, ean: null, nome: 'Detergente', descricao: null,
  unidadeVenda: 'CX', qtdPorEmbalagem: 24, qtdMinima: 1, descontoQtdMinima: null, descontoQtdPreco: null,
  dataValidade: null, marca: null, marcaId: null, categoria: 'Limpeza', categoriaId: 'c1', estoque: 100,
  precoTabela: 52.8, precoPromocional: null, preco: 52.8, imagens: [], ...extra,
});

describe('selosDoProduto', () => {
  it('produto comum não tem selo', () => {
    expect(selosDoProduto(produto(), 5)).toEqual([]);
  });
  it('oferta mostra o percentual', () => {
    expect(selosDoProduto(produto({ precoTabela: 79.9, precoPromocional: 59.9, preco: 59.9 }), 0))
      .toEqual([{ tipo: 'oferta', texto: '-25%' }]);
  });
  it('oferta sem preço de tabela mostra só "Oferta"', () => {
    expect(selosDoProduto(produto({ precoTabela: null, precoPromocional: 59.9, preco: 59.9 }), 0))
      .toEqual([{ tipo: 'oferta', texto: 'Oferta' }]);
  });
  it('estoque baixo só com limite ligado e estoque dentro dele', () => {
    expect(selosDoProduto(produto({ estoque: 3 }), 5)).toEqual([{ tipo: 'estoque', texto: '3 em estoque' }]);
    expect(selosDoProduto(produto({ estoque: 3 }), 0)).toEqual([]);
    expect(selosDoProduto(produto({ estoque: 6 }), 5)).toEqual([]);
  });
  it('validade e desconto por quantidade', () => {
    expect(selosDoProduto(produto({ dataValidade: '2026-12-05', descontoQtdMinima: 4, descontoQtdPreco: 49.9 }), 0)).toEqual([
      { tipo: 'validade', texto: 'Val. 05/12' },
      { tipo: 'quantidade', texto: '4 ou mais: R$ 49,90' },
    ]);
  });
});

describe('montarSecoesHome', () => {
  const pat = (id: string): Patrocinador => ({ tipo: 'patrocinador', id, nome: `Pat ${id}`, logoUrl: null, bannerUrl: null, produtos: [produto()] });
  const base: Home = {
    banners: [], promocoes: [produto()], maisVendidos: [produto()], vencimentoProximo: [produto()],
    prateleiras: [{ tipo: 'categoria', categoriaId: 'c1', nome: 'Limpeza', produtos: [produto()] }, pat('meio')],
    patrocinadoresTopo: [pat('topo')], patrocinadoresOfertas: [pat('ofertas')],
  };

  it('segue a ordem do app', () => {
    expect(montarSecoesHome(base).map((s) => s.chave)).toEqual([
      'pat-topo', 'ofertas', 'pat-ofertas', 'mais-vendidos', 'vencimento', 'cat-c1', 'pat-meio',
    ]);
  });
  it('ofertas e categoria têm "ver todos"; as outras não', () => {
    const s = montarSecoesHome(base);
    const de = (chave: string) => s.find((x) => x.chave === chave) as Extract<(typeof s)[number], { tipo: 'produtos' }>;
    expect(de('ofertas').verTodos).toBe('/ofertas');
    expect(de('cat-c1').verTodos).toBe('/c/limpeza-c1');
    expect(de('mais-vendidos').verTodos).toBeNull();
  });
  it('pula seção sem produto', () => {
    const s = montarSecoesHome({ ...base, promocoes: [], vencimentoProximo: [], patrocinadoresTopo: [] });
    expect(s.map((x) => x.chave)).toEqual(['pat-ofertas', 'mais-vendidos', 'cat-c1', 'pat-meio']);
  });
});
