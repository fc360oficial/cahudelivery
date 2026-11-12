import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

export const COOKIE_DISPOSITIVO = 'fc_dispositivo';
const UM_ANO = 60 * 60 * 24 * 365;

/** Identificador do carrinho anônimo (mesmo mecanismo X-Device-Id do app). Nulo = visitante sem carrinho. */
export async function lerDispositivo(): Promise<string | null> {
  return (await cookies()).get(COOKIE_DISPOSITIVO)?.value ?? null;
}

/** Só chamar em rota /api (cookies não podem ser gravados durante a renderização de página). */
export async function garantirDispositivo(): Promise<string> {
  const jar = await cookies();
  const atual = jar.get(COOKIE_DISPOSITIVO)?.value;
  if (atual) return atual;
  const novo = randomUUID();
  jar.set(COOKIE_DISPOSITIVO, novo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: UM_ANO,
  });
  return novo;
}
