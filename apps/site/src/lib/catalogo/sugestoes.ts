import type { Produto } from '@/lib/api/tipos';
import { emOferta } from '@/lib/catalogo/oferta';
import { caminhoProduto } from '@/lib/formato/caminhos';

/**
 * Busca com sugestões (Tiago, 19/11/2026): o cabeçalho baixa uma vez o índice do catálogo e responde enquanto a
 * pessoa digita, sem ir ao servidor a cada letra. A mesma regra de casar texto vale na página /busca, para a lista
 * completa nunca discordar do que as sugestões mostraram.
 */

/** Um produto no índice da busca: só o que as sugestões mostram. */
export interface ItemBusca {
  id: string;
  nome: string;
  caminho: string;
  unidadeVenda: string;
  qtdPorEmbalagem: number;
  qtdMinima: number;
  preco: number | null;
  /** Preço de tabela riscado, só quando há oferta que realmente baixa o preço. */
  precoDe: number | null;
  categoria: string | null;
  foto: string | null;
  comprar: boolean;
  /** Código interno e código de barras: quem digita o número acha o produto. */
  codigos: string;
}

export interface Sugestoes {
  total: number;
  produtos: ItemBusca[];
  /** Atalhos para afinar a busca: a palavra digitada + a palavra seguinte ("bisc marilan"), com a contagem. */
  refinos: { texto: string; n: number }[];
  categorias: { nome: string; n: number }[];
}

/** Sem acento, minúsculas e só letras, números e espaço: "Café 250G/CX" → "cafe 250g cx". */
export function normalizarBusca(s: string): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Palavras digitadas (no máximo 6). Menos de 2 caracteres no total não busca nada. */
export function tokensDe(q: string): string[] {
  const n = normalizarBusca(q);
  return n.replace(/ /g, '').length < 2 ? [] : n.split(' ').filter(Boolean).slice(0, 6);
}

/** Texto em que a busca procura: nome, marca, código e código de barras. */
export function chaveDeBusca(p: { nome: string; marca?: string | null; sku?: string | null; ean?: string | null }): string {
  return normalizarBusca([p.nome, p.marca, p.sku, p.ean].filter(Boolean).join(' '));
}

/** Casa quando TODAS as palavras digitadas aparecem (em qualquer ordem, inteiras ou pela metade). */
export function casa(chave: string, tokens: string[]): boolean {
  return tokens.length > 0 && tokens.every((t) => chave.includes(t));
}

export function itemDeBusca(p: Produto): ItemBusca {
  const foto = p.imagens[0];
  return {
    id: p.id, nome: p.nome, caminho: caminhoProduto(p), unidadeVenda: p.unidadeVenda, qtdPorEmbalagem: p.qtdPorEmbalagem,
    qtdMinima: p.qtdMinima, preco: p.preco, precoDe: emOferta(p) ? p.precoTabela : null, categoria: p.categoria,
    foto: foto ? (foto.miniatura ?? foto.url) : null, comprar: p.preco != null && p.estoque > 0,
    codigos: [p.marca, p.sku, p.ean].filter(Boolean).join(' '),
  };
}

const chaveDoItem = (i: ItemBusca) => normalizarBusca(`${i.nome} ${i.codigos}`);

/**
 * Sugestões para o texto digitado. Na frente vêm os produtos cujo nome COMEÇA pela primeira palavra; depois, ordem
 * alfabética. `categoria` restringe os produtos listados (os atalhos e a contagem por categoria olham tudo que casou).
 */
export function sugerir(itens: ItemBusca[], q: string, opcoes: { limite?: number; categoria?: string | null } = {}): Sugestoes {
  const tokens = tokensDe(q);
  if (tokens.length === 0) return { total: 0, produtos: [], refinos: [], categorias: [] };
  const achados = itens.filter((i) => casa(chaveDoItem(i), tokens));
  const comeca = (i: ItemBusca) => (normalizarBusca(i.nome).startsWith(tokens[0]) ? 0 : 1);
  achados.sort((a, b) => comeca(a) - comeca(b) || a.nome.localeCompare(b.nome, 'pt-BR'));

  const porCategoria = new Map<string, number>();
  for (const i of achados) if (i.categoria) porCategoria.set(i.categoria, (porCategoria.get(i.categoria) ?? 0) + 1);

  // atalhos: a palavra do nome que começa pelo que foi digitado + a palavra seguinte
  const pares = new Map<string, number>();
  if (tokens.length === 1) {
    for (const i of achados) {
      const palavras = normalizarBusca(i.nome).split(' ');
      const k = palavras.findIndex((w) => w.startsWith(tokens[0]));
      if (k >= 0 && palavras[k + 1] && !/^\d/.test(palavras[k + 1])) { const par = `${palavras[k]} ${palavras[k + 1]}`; pares.set(par, (pares.get(par) ?? 0) + 1); }
    }
  }
  const refinos = [...pares].map(([texto, n]) => ({ texto, n })).filter((r) => r.n < achados.length)
    .sort((a, b) => b.n - a.n || a.texto.localeCompare(b.texto)).slice(0, 4);

  const naCategoria = opcoes.categoria ? achados.filter((i) => i.categoria === opcoes.categoria) : achados;
  return {
    total: naCategoria.length,
    produtos: naCategoria.slice(0, opcoes.limite ?? 6),
    refinos,
    categorias: [...porCategoria].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome)),
  };
}
