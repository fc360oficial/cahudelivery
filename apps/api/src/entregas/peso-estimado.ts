/**
 * Peso estimado de um produto para a montagem de carga.
 *
 * O ERP não manda peso (a NF-e chega sem transp/vol), então o peso sai, nesta ordem:
 *  1. do cadastro (produtos.peso_kg), quando alguém informou o peso da caixa/fardo;
 *  2. do nome do produto: gramatura × quantidade da embalagem ("ACUCAR 1KG FD10" = 10 kg).
 * É estimativa: não conta a embalagem e trata 1 litro como 1 kg. Serve para montar a carga, não para balança.
 *
 * A quantidade de um item (pedido, faturamento ou nota) é sempre em UNIDADES DE VENDA (a caixa, o fardo),
 * mesmo quando a nota escreve "UN": conferido na NF 5060 (6 "UN" de um display de 30 a R$ 39,00).
 */

export interface ProdutoParaPeso {
  nome: string;
  /** Peso informado no cadastro, por unidade de venda. */
  pesoKg?: number | null;
  qtdPorEmbalagem?: number | null;
  unidadeVenda?: string | null;
}

export interface PesoEstimado {
  /** Quilos por unidade de venda; null = não deu para saber. */
  kg: number | null;
  origem: 'cadastro' | 'nome' | null;
}

const UNIDADE = '(KG|K|GR|G|ML|LT|L)';
// \p{L}\p{N}: "100 LÂMINAS" não pode virar 100 litros, nem "LV400" virar 400 g.
const ANTES = '(?<![\\p{L}\\p{N}.,])';
const DEPOIS = '(?![\\p{L}\\p{N}])';
const NUMERO = '(\\d+(?:[.,]\\d+)?)';
const RE_MULTI = new RegExp(`${ANTES}(\\d{1,3})\\s?X\\s?${NUMERO}\\s?${UNIDADE}${DEPOIS}`, 'iu');
const RE_SIMPLES = new RegExp(`${ANTES}${NUMERO}\\s?${UNIDADE}${DEPOIS}`, 'iu');
const RE_EMBALAGEM = new RegExp(`${ANTES}(?:CX|FD|PCT|PC|CT|C)\\s?\\/?\\s?(\\d{1,3})${DEPOIS}`, 'giu');
const RE_UNIDADES = new RegExp(`${ANTES}(\\d{1,3})\\s?UN(?:D|ID)?${DEPOIS}`, 'iu');

// Embalagem colada no número ("SC20KG" = saco de 20 kg, "LT350ML" = lata de 350 ml): separa para a gramatura ser lida.
// Só siglas de embalagem conhecidas; "LV400 PG360" (leve/pague) e "L40P36" continuam sem peso de propósito.
const RE_SIGLA_COLADA = /(?<![\p{L}\p{N}])(SC|PCT|PT|BD|GL|GF|FR|LT|LA|CP|TP)(?=\d)/giu;
const separarSigla = (nome: string) => nome.replace(RE_SIGLA_COLADA, '$1 ');

const numero = (texto: string) => Number(texto.replace(',', '.'));

function emQuilos(valor: number, unidade: string): number {
  const u = unidade.toUpperCase();
  return u === 'KG' || u === 'K' || u === 'L' || u === 'LT' ? valor : valor / 1000;
}

/** Peso de UMA unidade escrita no nome (o pacote de 200 g, a garrafa de 2 L). null = o nome não diz. */
export function gramaturaDoNome(nomeOriginal: string): number | null {
  const nome = separarSigla(nomeOriginal);
  const multi = RE_MULTI.exec(nome);
  if (multi) {
    const kg = Number(multi[1]) * emQuilos(numero(multi[2]), multi[3]);
    return kg > 0 ? kg : null;
  }
  const simples = RE_SIMPLES.exec(nome);
  if (!simples) return null;
  const kg = emQuilos(numero(simples[1]), simples[2]);
  return kg > 0 ? kg : null;
}

/** Quantas unidades vêm na caixa/fardo segundo o nome ("CX12", "FD10", "C/6", "30UN"). 1 = o nome não diz. */
export function embalagemDoNome(nome: string): number {
  let maior = 1;
  for (const m of nome.matchAll(RE_EMBALAGEM)) maior = Math.max(maior, Number(m[1]));
  const unidades = RE_UNIDADES.exec(nome);
  if (unidades) maior = Math.max(maior, Number(unidades[1]));
  return maior;
}

const arredondar = (kg: number) => Math.round(kg * 1000) / 1000;

/** Peso de uma unidade de venda do produto. */
export function pesoPorUnidadeDeVenda(p: ProdutoParaPeso): PesoEstimado {
  const cadastro = Number(p.pesoKg);
  if (p.pesoKg !== null && p.pesoKg !== undefined && Number.isFinite(cadastro) && cadastro > 0) {
    return { kg: arredondar(cadastro), origem: 'cadastro' };
  }
  // Vendido por quilo: a quantidade já é o peso.
  if (p.unidadeVenda?.toUpperCase() === 'KG') return { kg: 1, origem: 'nome' };
  const unidade = gramaturaDoNome(p.nome);
  if (unidade === null) return { kg: null, origem: null };
  // O cadastro e o nome nem sempre concordam ("PACK C2 ... 1L" com embalagem 1): vale o maior.
  const cadastrada = Number(p.qtdPorEmbalagem);
  const embalagem = Math.max(Number.isFinite(cadastrada) && cadastrada >= 1 ? cadastrada : 1, embalagemDoNome(p.nome));
  return { kg: arredondar(unidade * embalagem), origem: 'nome' };
}
