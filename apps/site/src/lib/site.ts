export function siteUrl(): string {
  return (process.env.SITE_URL ?? 'http://localhost:3010').replace(/\/+$/, '');
}

/** Enquanto o endereço for provisório o Google não deve indexar. */
export function indexavel(): boolean {
  return process.env.SITE_INDEXAVEL === 'true';
}

export function linkWhatsapp(numero: string | null): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.startsWith('55') && digitos.length >= 12 ? digitos : `55${digitos}`}`;
}