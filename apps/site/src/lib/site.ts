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
/** Endereço da empresa para o rodapé; cada instalação informa o seu em EMPRESA_ENDERECO. */
export function enderecoEmpresa(): string | null {
  const v = (process.env.EMPRESA_ENDERECO ?? '').trim();
  return v || null;
}

/** Loja que vende bebida alcoólica mostra a advertência no rodapé (VENDE_BEBIDA_ALCOOLICA=true). */
export function vendeBebidaAlcoolica(): boolean {
  return process.env.VENDE_BEBIDA_ALCOOLICA === 'true';
}
