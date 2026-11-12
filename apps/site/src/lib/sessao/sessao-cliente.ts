import 'server-only';
import { cookies, headers } from 'next/headers';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { expiracaoDoJwt, precisaRenovar } from './tokens';

export const COOKIE_ACESSO = 'fc_acesso';
export const COOKIE_RENOVA = 'fc_renova';
const QUINZE_MINUTOS = 15 * 60;
const TRINTA_DIAS = 60 * 60 * 24 * 30;

export interface ParTokens {
  accessToken: string;
  refreshToken: string;
}

/** A resposta da API trouxe mesmo um par de tokens? (nunca confiar no formato às cegas) */
export function parValido(v: unknown): v is ParTokens {
  const o = v as Partial<ParTokens> | null;
  return !!o && typeof o.accessToken === 'string' && o.accessToken.length > 0
    && typeof o.refreshToken === 'string' && o.refreshToken.length > 0;
}

/** Só em rota /api. Tokens só em cookie HttpOnly: o JavaScript do navegador nunca os vê. */
export async function gravarSessao(par: ParTokens, seguro: boolean): Promise<void> {
  const jar = await cookies();
  const base = { httpOnly: true, secure: seguro, sameSite: 'lax' as const, path: '/' };
  jar.set(COOKIE_ACESSO, par.accessToken, { ...base, maxAge: QUINZE_MINUTOS });
  jar.set(COOKIE_RENOVA, par.refreshToken, { ...base, maxAge: TRINTA_DIAS });
}

/** Sai da conta: apaga os cookies de sessão. O fc_dispositivo fica. */
export async function apagarSessao(): Promise<void> {
  const jar = await cookies();
  for (const nome of [COOKIE_ACESSO, COOKIE_RENOVA]) {
    jar.set(nome, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

/** Primeiro valor do x-forwarded-for que o proxy (Caddy) gravou; só se parecer um IP. */
export function ipDoVisitante(h: Headers): string | undefined {
  const primeiro = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return primeiro && primeiro.length <= 64 && /^[0-9a-fA-F:.]+$/.test(primeiro) ? primeiro : undefined;
}

/**
 * Access token utilizável, renovando pelo fc_renova quando falta ou vence em < 60 s.
 * Nulo = visitante. Refresh recusado (401) apaga a sessão. Outras falhas da API sobem
 * como ErroApi: a rota responde erro em vez de rebaixar o cliente para visitante.
 * Só em rota /api (pode gravar cookies).
 */
export async function tokenValido(seguro: boolean): Promise<string | null> {
  const jar = await cookies();
  const acesso = jar.get(COOKIE_ACESSO)?.value || null;
  const renova = jar.get(COOKIE_RENOVA)?.value || null;
  const agora = Date.now();

  if (acesso && !precisaRenovar(acesso, agora)) return acesso;
  if (!renova) {
    const exp = acesso ? expiracaoDoJwt(acesso) : null;
    return acesso && exp !== null && exp * 1000 > agora ? acesso : null;
  }

  try {
    const par = await chamarApi<unknown>('/auth/refresh', {
      metodo: 'POST',
      corpo: { refreshToken: renova },
      ipCliente: ipDoVisitante(await headers()),
    });
    if (!parValido(par)) throw new ErroApi(502, 'Resposta inesperada do servidor.');
    await gravarSessao(par, seguro);
    return par.accessToken;
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) {
      await apagarSessao();
      return null;
    }
    throw e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
  }
}
