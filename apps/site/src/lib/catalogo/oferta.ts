import type { Produto } from '@/lib/api/tipos';

/** Mostra o preço de tabela riscado: há promoção e ela realmente baixa o preço. */
export function emOferta(p: Produto): boolean {
  return p.precoPromocional != null && p.precoTabela != null && p.precoTabela > (p.preco ?? 0);
}
