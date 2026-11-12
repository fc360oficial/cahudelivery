import 'server-only';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { dispositivoValido } from './requisicao';

export const COOKIE_DISPOSITIVO = 'fc_dispositivo';
const UM_ANO = 60 * 60 * 24 * 365;

/** Identificador do carrinho anônimo (mesmo mecanismo X-Device-Id do app). Nulo = visitante sem carrinho. */
export async function lerDispositivo(): Promise<string | null> {
  return dispositivoValido((await cookies()).get(COOKIE_DISPOSITIVO)?.value);
}

/** Só chamar em rota /api (cookies não podem ser gravados durante a renderização de página).
 *  `seguro` = a requisição veio em https (ver requisicaoSegura): em http o navegador descartaria um cookie Secure. */
export async function garantirDispositivo(seguro: boolean): Promise<string> {
  const jar = await cookies();
  const atual = dispositivoValido(jar.get(COOKIE_DISPOSITIVO)?.value);
  if (atual) return atual;
  const novo = randomUUID();
  jar.set(COOKIE_DISPOSITIVO, novo, {
    httpOnly: true,
    secure: seguro,
    sameSite: 'lax',
    path: '/',
    maxAge: UM_ANO,
  });
  return novo;
}
