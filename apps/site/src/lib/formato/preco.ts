const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 52,80". O Intl usa espaço inseparável; trocamos por espaço comum para comparar e copiar. */
export function formatarPreco(valor: number): string {
  return BRL.format(valor).replace(/\u00a0/g, ' ');
}

/** Preço de cada unidade dentro da embalagem; nulo quando a embalagem é a própria unidade. */
export function precoPorUnidade(preco: number, qtdPorEmbalagem: number): number | null {
  if (!(qtdPorEmbalagem > 1)) return null;
  return Math.round((preco / qtdPorEmbalagem) * 100) / 100;
}

/** Desconto inteiro em % entre o preço de tabela e o preço final; nulo se não há desconto. */
export function percentualDesconto(precoTabela: number | null, preco: number | null): number | null {
  if (precoTabela == null || preco == null || !(precoTabela > 0) || preco >= precoTabela) return null;
  return Math.round((1 - preco / precoTabela) * 100);
}
