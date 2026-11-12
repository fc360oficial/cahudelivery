/** Proteção contra envio forjado: quem altera dados tem que vir do próprio site. */
export function origemConfere(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
