import { UUID_INTEIRO } from '@/lib/formato/caminhos';

/** O visitante está em https? Atrás do Caddy o site recebe http puro e o proxy avisa em x-forwarded-proto. */
export function requisicaoSegura(headers: Headers, url: string): boolean {
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (proto) return proto === 'https';
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Valor de cookie só vale se for um UUID inteiro; qualquer outra coisa é "sem cookie". */
export function dispositivoValido(valor: string | undefined): string | null {
  return valor && UUID_INTEIRO.test(valor) ? valor : null;
}
