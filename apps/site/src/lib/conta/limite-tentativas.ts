/**
 * Limite de tentativas erradas por chave, guardado na memória do processo do site. Serve de freio
 * para quem está com uma sessão aberta e tenta adivinhar a senha atual na troca de senha (a API
 * não limita essa rota). Vale por processo: reiniciar o site zera a contagem, o que é aceitável
 * para um freio; o limite definitivo é assunto da API.
 */
export interface Limite {
  bloqueado(chave: string, agoraMs: number): boolean;
  registrarFalha(chave: string, agoraMs: number): void;
  limpar(chave: string): void;
  tamanho(): number;
}

export function criarLimite(op: { maximo: number; janelaMs: number; maximoDeChaves?: number }): Limite {
  const falhas = new Map<string, number[]>();
  const maximoDeChaves = op.maximoDeChaves ?? 5000;

  const recentes = (chave: string, agoraMs: number): number[] => {
    const validas = (falhas.get(chave) ?? []).filter((t) => agoraMs - t < op.janelaMs);
    if (validas.length > 0) falhas.set(chave, validas);
    else falhas.delete(chave);
    return validas;
  };

  return {
    bloqueado: (chave, agoraMs) => recentes(chave, agoraMs).length >= op.maximo,
    registrarFalha(chave, agoraMs) {
      // Antes de crescer, joga fora o que já venceu; se ainda assim estourar, descarta a mais antiga.
      if (falhas.size >= maximoDeChaves) for (const k of [...falhas.keys()]) recentes(k, agoraMs);
      if (falhas.size >= maximoDeChaves) falhas.delete(falhas.keys().next().value as string);
      falhas.set(chave, [...recentes(chave, agoraMs), agoraMs]);
    },
    limpar: (chave) => { falhas.delete(chave); },
    tamanho: () => falhas.size,
  };
}

/**
 * `sub` (id do cliente) do payload de um JWT, SEM verificar a assinatura. Só serve como chave do
 * limite: uma falha só é contada depois que a API aceitou o token, então um `sub` forjado não
 * consegue contar falha no nome de outro cliente.
 */
export function sujeitoDoJwt(token: string): string | null {
  const partes = token.split('.');
  if (partes.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(partes[1] ?? '')) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    const sub = (payload as { sub?: unknown } | null)?.sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}
