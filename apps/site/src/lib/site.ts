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

/** Bandeiras de cartão que aparecem em selo no rodapé. Padrão: as que o Tiago confirmou em 19/11/2026 (Mastercard,
 *  Visa, Elo, American Express e Hipercard); `BANDEIRAS_CARTAO=visa,mastercard` (separadas por vírgula) troca a
 *  lista. Nome desconhecido é ignorado. */
const BANDEIRAS_CONHECIDAS = ['visa', 'mastercard', 'elo', 'hipercard', 'amex'];
export function bandeirasCartao(): string[] {
  const bruto = process.env.BANDEIRAS_CARTAO;
  const lista = (bruto == null ? 'mastercard,visa,elo,amex,hipercard' : bruto).split(',').map((b) => b.trim().toLowerCase());
  return [...new Set(lista.filter((b) => BANDEIRAS_CONHECIDAS.includes(b)))];
}

/** Loja que vende bebida alcoólica mostra a advertência no rodapé (VENDE_BEBIDA_ALCOOLICA=true). */
export function vendeBebidaAlcoolica(): boolean {
  return process.env.VENDE_BEBIDA_ALCOOLICA === 'true';
}

/**
 * Chave de implantação do fechamento de pedido pelo site (criar pedido e pagar com cartão).
 * Só `CHECKOUT_LIGADO=true` liga; ausente ou qualquer outro valor = desligado. Lida no servidor
 * na hora de renderizar: trocar o valor exige rebuild/restart do site (como SITE_INDEXAVEL).
 */
export function checkoutLigado(): boolean {
  return process.env.CHECKOUT_LIGADO === 'true';
}

/** Aviso mostrado no lugar do fechamento quando a chave está desligada. */
export function avisoCheckoutDesligado(appNome: string): string {
  return `Fechamento do pedido pelo site em breve. Por enquanto finalize pelo app ${appNome}: seu carrinho já está lá.`;
}
