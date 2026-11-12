interface Precos {
  preco: number | null;
  precoTabela: number | null;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
}

/** Espelha o cálculo de OrdersService.carrinho(): o menor entre o preço final e o desconto por
 *  quantidade, e o desconto só vale se o produto tem preço de tabela. A API continua sendo a
 *  fonte da verdade; isto só adianta o total na tela antes de gravar no carrinho. */
export function precoEfetivo(p: Precos, quantidade: number): number | null {
  if (p.preco == null) return null;
  const temDesconto = p.precoTabela != null && p.descontoQtdMinima != null && p.descontoQtdPreco != null
    && quantidade >= p.descontoQtdMinima;
  return temDesconto ? Math.min(p.preco, p.descontoQtdPreco as number) : p.preco;
}
