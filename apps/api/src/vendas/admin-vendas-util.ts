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
  return Number.isFinite(p) && p >= 1 ? Math.min(p, 100000) : 1;
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

/** Percentual padrão da meta: 5% sobre o que o vendedor vendeu no mês anterior. */
export const META_PERCENTUAL_PADRAO = 5;

/** Lê `configuracoes.valor_json` de `vendas_meta_percentual` (aceita `{valor: 5}` ou o número puro); ausente ou inválido = 5. */
export function lerPercentualMeta(valorJson: unknown): number {
  const bruto =
    valorJson !== null && typeof valorJson === 'object'
      ? (valorJson as { valor?: unknown }).valor
      : valorJson;
  const v = bruto === null || bruto === undefined || bruto === '' ? NaN : Number(bruto);
  return Number.isFinite(v) && v >= 0 ? v : META_PERCENTUAL_PADRAO;
}

/** Meta do mês = vendido no mês anterior × (1 + percentual/100). Sem venda no mês anterior não há meta (null), nunca zero. */
export function calcularMeta(vendidoMesAnterior: number, vendidoMes: number, percentual: number) {
  const metaMes = vendidoMesAnterior > 0 ? dinheiro(vendidoMesAnterior * (1 + percentual / 100)) : null;
  return {
    metaMes,
    atingidoPct: metaMes ? pct1((vendidoMes / metaMes) * 100) : null,
    faltam: metaMes ? dinheiro(Math.max(metaMes - vendidoMes, 0)) : null,
  };
}

/** Status em que o ERP já faturou o pedido do vendedor: só esses contam como "vendido". */
export const SQL_STATUS_FATURADO = `p.status in ('FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE')`;

/**
 * CTE única de "vendas faturadas" (pedido de vendedor que o ERP faturou), usada por meta, ranking, resumo e painel.
 * Colunas: pedido_id, vendedor_id, valor, data.
 *  - valor = total faturado enviado pelo ERP (pedido_faturamentos.total) ou, na falta, o total do pedido;
 *  - data  = pedido_faturamentos.faturado_em, ou o 1º evento FATURADO, ou (último recurso) criado_em. O dia/mês é
 *            sempre lido no fuso de Recife pelo chamador.
 * Uso: `with ${cteVendasFaturadas()} select ... from vf`. `extraWhere` (ex.: "p.vendedor_id = $1") entra no where.
 */
export function cteVendasFaturadas(nome = 'vf', extraWhere = ''): string {
  return `${nome} as (
       select p.id as pedido_id, p.vendedor_id,
              coalesce(f.total, p.total) as valor,
              coalesce(f.faturado_em, ev.em, p.criado_em) as data
         from pedidos p
         left join pedido_faturamentos f on f.pedido_id = p.id
         left join lateral (select min(e.criado_em) as em from pedido_eventos e
                             where e.pedido_id = p.id and e.status = 'FATURADO') ev on true
        where p.origem = 'vendedor' and ${SQL_STATUS_FATURADO}${extraWhere ? ` and ${extraWhere}` : ''}
     )`;
}

/**
 * CTE de devoluções de venda (o que o cliente devolveu e o ERP deu entrada). Colunas: vendedor_id, valor, data.
 * A devolução abate a venda do vendedor no período em que ENTROU (data = devolvido_em), não no da venda.
 * Devolução cancelada não conta. `extraWhere` (ex.: "d.vendedor_id = $1") entra no where.
 */
export function cteDevolucoes(nome = 'dv', extraWhere = ''): string {
  return `${nome} as (
       select d.vendedor_id, d.valor, d.devolvido_em as data
         from devolucoes_venda d
        where not d.cancelada${extraWhere ? ` and ${extraWhere}` : ''}
     )`;
}

/** Base da meta: o faturamento do mês anterior que o ERP mandou (se houver linha) ou, senão, o nosso próprio faturado. */
export function escolherBaseMeta(
  erp: unknown,
  proprio: number,
): { valor: number; origem: 'erp' | 'pedidos' | null } {
  const valor = erp !== null && erp !== undefined ? dinheiro(n(erp)) : dinheiro(proprio);
  const origem = erp !== null && erp !== undefined ? 'erp' : 'pedidos';
  return { valor, origem: valor > 0 ? origem : null };
}
