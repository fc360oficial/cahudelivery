/** Folga: renova o access token quando faltar menos que isto para vencer. */
const FOLGA_SEGUNDOS = 60;

/**
 * `exp` (segundos desde 1970) do payload de um JWT, SEM verificar a assinatura.
 * Serve só para decidir quando renovar; quem valida o token é a API. Nulo se malformado.
 */
export function expiracaoDoJwt(token: string): number | null {
  const partes = token.split('.');
  if (partes.length !== 3 || !partes[1] || !/^[A-Za-z0-9_-]+$/.test(partes[1])) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** Sem token, malformado ou vencendo em menos de 60 s: renovar. */
export function precisaRenovar(token: string | null, agoraMs: number): boolean {
  if (!token) return true;
  const exp = expiracaoDoJwt(token);
  if (exp === null) return true;
  return exp - agoraMs / 1000 < FOLGA_SEGUNDOS;
}
