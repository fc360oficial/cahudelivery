/** Recebe "AAAA-MM-DD" ou ISO completo e devolve "DD/MM". */
export function formatarValidade(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}
