import { UUID_INTEIRO } from '@/lib/formato/caminhos';

/** Resposta de GET /favoritos da API: só entram ids no formato certo, em minúsculas e sem repetir. */
export function normalizarFavoritos(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const ids = new Set<string>();
  for (const v of bruto) if (typeof v === 'string' && UUID_INTEIRO.test(v)) ids.add(v.toLowerCase());
  return [...ids];
}

/** Visitante que tocou no coração: o produto fica guardado até ele entrar, por este tempo. */
export const VALIDADE_PENDENTE_MS = 15 * 60 * 1000;

/** Texto guardado no navegador enquanto o visitante vai para "Entrar". */
export function montarPendente(produtoId: string, agora: number): string {
  return JSON.stringify({ id: produtoId, quando: agora });
}

/** Devolve o produto a favoritar depois de entrar; nulo se o texto é inválido ou já venceu. */
export function lerPendente(texto: string | null, agora: number): string | null {
  if (!texto) return null;
  try {
    const v = JSON.parse(texto) as { id?: unknown; quando?: unknown } | null;
    if (!v || typeof v.id !== 'string' || !UUID_INTEIRO.test(v.id) || typeof v.quando !== 'number') return null;
    const idade = agora - v.quando;
    return idade >= 0 && idade <= VALIDADE_PENDENTE_MS ? v.id.toLowerCase() : null;
  } catch {
    return null;
  }
}
