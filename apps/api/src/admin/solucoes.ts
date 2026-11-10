/** Soluções da retaguarda: cada usuário entra no painel de Delivery e/ou no de Vendas. */
export const SOLUCOES = ['delivery', 'vendas'] as const;
export type Solucao = (typeof SOLUCOES)[number];

/** Lista efetiva: admin sempre tem as duas; sem lista (token antigo) vale só Delivery. */
export function solucoesEfetivas(papel: string, lista: unknown): Solucao[] {
  if (papel === 'admin') return [...SOLUCOES];
  if (!Array.isArray(lista)) return ['delivery'];
  return SOLUCOES.filter((s) => lista.includes(s));
}

/**
 * Caminho da requisição (pathname interpretado como o Express roteia, inclusive alvo em
 * forma absoluta), minúsculo e sem barra final. null = alvo ilegível.
 */
export function caminhoDaRequisicao(url: string): string | null {
  let caminho: string;
  try {
    caminho = new URL(url, 'http://x').pathname.toLowerCase();
  } catch {
    return null;
  }
  return caminho.length > 1 ? caminho.replace(/\/+$/, '') : caminho;
}

const dentro = (caminho: string, prefixo: string) =>
  caminho === prefixo || caminho.startsWith(`${prefixo}/`);

/** Rotas que não exigem solução: autenticação, usuários e logs de integração do ERP. */
const ISENTAS = [
  '/v1/admin/auth',
  '/v1/admin/usuarios',
  '/v1/admin/logs/integracao',
];

/** Solução exigida pela rota, ou null quando a rota é isenta. */
export function solucaoExigida(caminho: string): Solucao | null {
  if (ISENTAS.some((p) => dentro(caminho, p))) return null;
  return dentro(caminho, '/v1/admin/vendas') ? 'vendas' : 'delivery';
}
