import 'server-only';
import { cookies, headers } from 'next/headers';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { decidirSessao, type EstadoSessao } from './estado-sessao';

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

/** Sai da conta: apaga os cookies de sessão com os mesmos atributos da gravação. O fc_dispositivo fica. */
export async function apagarSessao(seguro: boolean): Promise<void> {
  const jar = await cookies();
  for (const nome of [COOKIE_ACESSO, COOKIE_RENOVA]) {
    jar.set(nome, '', { httpOnly: true, secure: seguro, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

/** Primeiro valor do x-forwarded-for que o proxy (Caddy) gravou; só se parecer um IP. */
export function ipDoVisitante(h: Headers): string | undefined {
  const primeiro = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return primeiro && primeiro.length <= 64 && /^[0-9a-fA-F:.]+$/.test(primeiro) ? primeiro : undefined;
}

/**
 * Estado da sessão, renovando pelo fc_renova quando o access token falta ou vence em < 60 s.
 * "expirada" = havia sessão e o refresh foi recusado (401): os cookies já foram apagados e a
 * rota deve responder 401, não tratar como visitante. Outras falhas da API sobem como ErroApi.
 * Só em rota /api (pode gravar cookies).
 */
export async function estadoDaSessao(seguro: boolean): Promise<EstadoSessao> {
  const jar = await cookies();
  const cookiesDaSessao = {
    acesso: jar.get(COOKIE_ACESSO)?.value || null,
    renova: jar.get(COOKIE_RENOVA)?.value || null,
  };
  const ip = ipDoVisitante(await headers());

  const estado = await decidirSessao(cookiesDaSessao, Date.now(), async (renova) => {
    try {
      const par = await chamarApi<unknown>('/auth/refresh', { metodo: 'POST', corpo: { refreshToken: renova }, ipCliente: ip });
      if (!parValido(par)) throw new ErroApi(502, 'Resposta inesperada do servidor.');
      await gravarSessao(par, seguro);
      return par.accessToken;
    } catch (e) {
      if (e instanceof ErroApi && e.status === 401) return null;
      throw e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    }
  });
  if (estado.estado === 'expirada') await apagarSessao(seguro);
  return estado;
}
