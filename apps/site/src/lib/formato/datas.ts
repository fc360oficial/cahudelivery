const FUSO = 'America/Sao_Paulo';
const DATA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });

function instante(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "dd/mm/aaaa" no horário de Brasília. "AAAA-MM-DD" (coluna date) é lida sem fuso. */
export function formatarData(iso: string | null | undefined): string {
  const pura = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (pura) return `${pura[3]}/${pura[2]}/${pura[1]}`;
  const d = instante(iso);
  return d ? DATA.format(d) : '—';
}

/** "dd/mm/aaaa às hh:mm" no horário de Brasília. */
export function formatarDataHora(iso: string | null | undefined): string {
  const d = instante(iso);
  return d ? `${DATA.format(d)} às ${HORA.format(d)}` : '—';
}

/** Recebe "AAAA-MM-DD" ou ISO completo e devolve "DD/MM". */
export function formatarValidade(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}
