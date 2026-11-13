const REPASSA = new Set([400, 401, 403, 409, 422, 429]);
const GENERICA = 'Não foi possível concluir agora. Tente novamente.';
const SEM_SERVIDOR = 'Não foi possível falar com o servidor. Tente novamente.';

/**
 * Erro da API → resposta ao navegador. Só 400/401/403/409/422/429 levam a `message` da API
 * (escrita para o cliente); 404 repassa o status com texto próprio; o resto vira genérico.
 * Nunca o corpo bruto.
 */
export function erroDaConta(status: number, mensagem: string): { status: number; corpo: { mensagem: string } } {
  if (REPASSA.has(status)) return { status, corpo: { mensagem } };
  if (status === 404) return { status: 404, corpo: { mensagem: 'Não encontrado.' } };
  if (status === 503) return { status: 503, corpo: { mensagem: SEM_SERVIDOR } };
  return { status: 500, corpo: { mensagem: GENERICA } };
}

/**
 * POST auth/senha responde 401 "Senha atual incorreta" (UnauthorizedException com texto).
 * O 401 do JwtAuthGuard não tem texto (Nest devolve "Unauthorized"): esse é sessão vencida.
 */
export function senhaAtualRecusada(status: number, mensagem: string): boolean {
  return status === 401 && mensagem !== 'Unauthorized';
}
