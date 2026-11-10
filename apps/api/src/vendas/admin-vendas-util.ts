import { BadRequestException } from '@nestjs/common';
import { arredondar } from './conferir-pedido';

export const POR_PAGINA = 30;

/** Pedido que não conta como venda: cancelado, retido ou aguardando pagamento. Mesma definição do app do vendedor. */
export const SQL_STATUS_VENDA = `p.status not in ('CANCELADO','AGUARDANDO_VENDEDOR','AGUARDANDO_PAGAMENTO')`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const n = (v: unknown): number => Number(v ?? 0);
export const nOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
export const pct1 = (v: number): number => Math.round(Number((v * 10).toPrecision(15))) / 10;
export const dinheiro = arredondar;

/** pg devolve Date para timestamptz; os mocks e o JSON devolvem string. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

/** Parâmetro de id opcional: ausente/vazio = sem filtro; fora do formato UUID = 400. */
export function uuidOpcional(v: unknown, campo: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) {
    throw new BadRequestException({ statusCode: 400, message: `${campo} inválido`, codigo: 'PARAMETRO_INVALIDO' });
  }
  return v.toLowerCase();
}

export function paginaDe(v: unknown): number {
  const p = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(p) && p >= 1 ? p : 1;
}

export function escolher<T extends string>(v: unknown, validos: readonly T[], padrao: T): T {
  return typeof v === 'string' && (validos as readonly string[]).includes(v) ? (v as T) : padrao;
}

/** Texto de busca vira padrão ILIKE; % e _ digitados valem como letra. */
export function padraoBusca(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, 80);
  if (!t) return null;
  return `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

/** Soma de dias a uma data 'YYYY-MM-DD' (aritmética em UTC, sem fuso). */
export function addDias(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(ini: string, fim: string): number {
  return Math.round((Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${ini}T00:00:00Z`)) / 86400000);
}
