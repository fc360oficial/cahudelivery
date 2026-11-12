import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export function validarItem(corpo: unknown): { produtoId: string; quantidade: number } | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { produtoId, quantidade } = corpo as Record<string, unknown>;
  if (typeof produtoId !== 'string' || !UUID_INTEIRO.test(produtoId)) return null;
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade < 0 || quantidade > 9999) return null;
  return { produtoId, quantidade };
}
