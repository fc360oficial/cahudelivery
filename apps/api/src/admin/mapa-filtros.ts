export const STATUS_VALIDOS = [
  'RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO', 'CANCELADO',
] as const;
export const STATUS_PADRAO = STATUS_VALIDOS.filter((s) => s !== 'CANCELADO') as string[];

export interface FiltrosMapa {
  de: string;   // YYYY-MM-DD
  ate: string;  // YYYY-MM-DD
  status: string[];
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseFiltrosMapa(q: { de?: string; ate?: string; status?: string }, hoje = new Date()): FiltrosMapa {
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const de = q.de && DATA_RE.test(q.de) ? q.de : iso(seteDiasAtras);
  const ate = q.ate && DATA_RE.test(q.ate) ? q.ate : iso(hoje);
  const pedidos = (q.status ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is (typeof STATUS_VALIDOS)[number] => (STATUS_VALIDOS as readonly string[]).includes(s));
  return { de, ate, status: pedidos.length ? pedidos : STATUS_PADRAO };
}
