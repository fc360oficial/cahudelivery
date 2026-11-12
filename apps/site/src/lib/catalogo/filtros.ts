import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const ORDENS = ['nome', 'preco_asc', 'preco_desc'] as const;
export type Ordem = (typeof ORDENS)[number];
export const ROTULO_ORDEM: Record<Ordem, string> = { nome: 'Nome', preco_asc: 'Menor preço', preco_desc: 'Maior preço' };

export interface Filtros { pagina: number; ordem: Ordem; marca: string | null; sub: string | null }
export type ParametrosUrl = Record<string, string | string[] | undefined>;

const PAGINA_MAXIMA = 500;
const um = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? undefined : v);
const uuid = (v: string | undefined): string | null => (v && UUID_INTEIRO.test(v) ? v : null);

/** Tudo que vem da URL é validado aqui; valor inválido vira o padrão e nunca chega à API. */
export function lerFiltros(sp: ParametrosUrl): Filtros {
  const n = Number(um(sp.pagina));
  const pagina = Number.isInteger(n) && n >= 1 ? Math.min(n, PAGINA_MAXIMA) : 1;
  const ordemBruta = um(sp.ordem);
  const ordem = (ORDENS as readonly string[]).includes(ordemBruta ?? '') ? (ordemBruta as Ordem) : 'nome';
  return { pagina, ordem, marca: uuid(um(sp.marca)), sub: uuid(um(sp.sub)) };
}

/** Monta o link de um filtro ou página. Trocar qualquer filtro volta para a página 1. */
export function hrefCom(base: string, atual: Filtros, mudanca: Partial<Filtros>, fixos: Record<string, string> = {}): string {
  const mudouFiltro = Object.keys(mudanca).some((k) => k !== 'pagina');
  const f: Filtros = { ...atual, ...mudanca, pagina: mudanca.pagina ?? (mudouFiltro ? 1 : atual.pagina) };
  const q = new URLSearchParams(fixos);
  if (f.sub) q.set('sub', f.sub);
  if (f.marca) q.set('marca', f.marca);
  if (f.ordem !== 'nome') q.set('ordem', f.ordem);
  if (f.pagina > 1) q.set('pagina', String(f.pagina));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
