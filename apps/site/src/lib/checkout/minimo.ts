/** Barra do pedido mínimo do carrinho (mesma conta do app: carrinho_screen.dart). */
export interface BarraMinimo {
  temMinimo: boolean;
  atingiu: boolean;
  /** Quanto falta, em reais (0 quando atingiu). */
  falta: number;
  /** 0 a 1. */
  progresso: number;
  minimo: number;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** `minimo` nulo ou ≤ 0 = sem pedido mínimo. Quem recusa de verdade é a API (POST pedidos). */
export function barraDoMinimo(subtotal: number, minimo: number | null): BarraMinimo {
  const s = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  if (minimo == null || !(minimo > 0)) return { temMinimo: false, atingiu: true, falta: 0, progresso: 1, minimo: 0 };
  const falta = centavos(minimo - s);
  if (falta <= 0) return { temMinimo: true, atingiu: true, falta: 0, progresso: 1, minimo };
  return { temMinimo: true, atingiu: false, falta, progresso: Math.min(1, s / minimo), minimo };
}

export type MotivoBloqueio = 'vazio' | 'minimo' | 'em-analise';

/**
 * Botão "Finalizar pedido" do cliente logado. Como no app: carrinho com itens, mínimo atingido e
 * cadastro que não esteja "pendente". Status que não deu para ler não trava: a API decide no fim.
 */
export function podeFinalizar(e: { itens: number; atingiu: boolean; statusCadastro: string | null }): { pode: boolean; motivo: MotivoBloqueio | null } {
  if (e.itens <= 0) return { pode: false, motivo: 'vazio' };
  if (e.statusCadastro === 'pendente') return { pode: false, motivo: 'em-analise' };
  if (!e.atingiu) return { pode: false, motivo: 'minimo' };
  return { pode: true, motivo: null };
}
