/** Soluções da retaguarda: cada usuário entra no painel de Delivery e/ou no de Vendas. */
export const SOLUCOES = ['delivery', 'vendas'] as const;
export type Solucao = (typeof SOLUCOES)[number];

/** Lista efetiva: admin sempre tem as duas; sem lista (token antigo) vale só Delivery. */
export function solucoesEfetivas(papel: string, lista: unknown): Solucao[] {
  if (papel === 'admin') return [...SOLUCOES];
  if (!Array.isArray(lista)) return ['delivery'];
  return SOLUCOES.filter((s) => lista.includes(s));
}

/** Caminho da requisição sem query string, minúsculo e sem barra final. */
export function caminhoDaRequisicao(url: string): string {
  const semQuery = url.split('?')[0].split('#')[0].toLowerCase();
  return semQuery.length > 1 ? semQuery.replace(/\/+$/, '') : semQuery;
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
