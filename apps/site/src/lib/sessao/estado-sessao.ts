import { precisaRenovar, expiracaoDoJwt } from './tokens';

/**
 * visitante: sem cookie de sessão. logado: access token utilizável.
 * expirada: havia sessão e ela não pôde ser renovada (a rota deve responder 401, nunca tratar como visitante).
 */
export type EstadoSessao =
  | { estado: 'visitante' }
  | { estado: 'logado'; token: string }
  | { estado: 'expirada' };

/**
 * Decide o estado a partir dos cookies. `renovar` troca o refresh token por um access token
 * novo: devolve nulo quando a API RECUSA (401) e lança nas demais falhas (que sobem, sem rebaixar
 * o cliente). Sem efeitos colaterais: gravar/apagar cookie é com quem chama.
 */
export async function decidirSessao(
  cookies: { acesso: string | null; renova: string | null },
  agoraMs: number,
  renovar: (renova: string) => Promise<string | null>,
): Promise<EstadoSessao> {
  const { acesso, renova } = cookies;
  if (acesso && !precisaRenovar(acesso, agoraMs)) return { estado: 'logado', token: acesso };
  if (!renova) {
    if (!acesso) return { estado: 'visitante' };
    const exp = expiracaoDoJwt(acesso);
    return exp !== null && exp * 1000 > agoraMs ? { estado: 'logado', token: acesso } : { estado: 'expirada' };
  }
  const novo = await renovar(renova);
  return novo ? { estado: 'logado', token: novo } : { estado: 'expirada' };
}
