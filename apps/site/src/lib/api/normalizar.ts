import type {
  Banner, Carrinho, Categoria, ConfigLoja, Home, Patrocinador, Prateleira, Produto,
} from './tipos';

type Bruto = Record<string, unknown>;

const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown, padrao = 0): number => numOuNulo(v) ?? padrao;
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? (v as Bruto[]) : []);

export function normalizarProduto(b: Bruto): Produto {
  return {
    id: String(b.id),
    sku: txt(b.sku),
    ean: txt(b.ean),
    nome: String(b.nome ?? ''),
    descricao: txt(b.descricao),
    unidadeVenda: String(b.unidade_venda ?? 'UN'),
    qtdPorEmbalagem: num(b.qtd_por_embalagem, 1),
    qtdMinima: Math.max(1, num(b.qtd_minima, 1)),
    descontoQtdMinima: numOuNulo(b.desconto_qtd_minima),
    descontoQtdPreco: numOuNulo(b.desconto_qtd_preco),
    dataValidade: txt(b.data_validade),
    marca: txt(b.marca),
    marcaId: txt(b.marca_id),
    categoria: txt(b.categoria),
    categoriaId: txt(b.categoria_id),
    estoque: num(b.estoque),
    precoTabela: numOuNulo(b.preco_tabela),
    precoPromocional: numOuNulo(b.preco_promocional),
    preco: numOuNulo(b.preco),
    imagens: lista(b.imagens)
      .filter((i) => typeof i.url === 'string')
      .map((i) => ({ url: String(i.url), miniatura: txt(i.miniatura) })),
  };
}

const produtos = (v: unknown): Produto[] => lista(v).map(normalizarProduto);

function normalizarBanner(b: Bruto): Banner {
  return {
    id: String(b.id),
    titulo: txt(b.titulo),
    imagemUrl: String(b.imagem_url ?? ''),
    destinoTipo: txt(b.destino_tipo),
    destinoId: txt(b.destino_id),
  };
}

function normalizarPatrocinador(b: Bruto): Patrocinador {
  return {
    tipo: 'patrocinador',
    id: String(b.id),
    nome: String(b.nome ?? ''),
    logoUrl: txt(b.logoUrl),
    bannerUrl: txt(b.bannerUrl),
    produtos: produtos(b.produtos),
  };
}

function normalizarPrateleira(b: Bruto): Prateleira {
  if (b.tipo === 'patrocinador') return normalizarPatrocinador(b);
  return {
    tipo: 'categoria',
    categoriaId: String(b.categoriaId),
    nome: String(b.nome ?? ''),
    produtos: produtos(b.produtos),
  };
}

export function normalizarHome(b: Bruto): Home {
  return {
    banners: lista(b.banners).map(normalizarBanner).filter((x) => x.imagemUrl),
    promocoes: produtos(b.promocoes),
    maisVendidos: produtos(b.maisVendidos),
    vencimentoProximo: produtos(b.vencimentoProximo),
    prateleiras: lista(b.prateleiras).map(normalizarPrateleira),
    patrocinadoresTopo: lista(b.patrocinadoresTopo).map(normalizarPatrocinador),
    patrocinadoresOfertas: lista(b.patrocinadoresOfertas).map(normalizarPatrocinador),
  };
}

export function normalizarCategoria(b: Bruto): Categoria {
  return { id: String(b.id), paiId: txt(b.pai_id), nome: String(b.nome ?? ''), imagemUrl: txt(b.imagem_url) };
}

export function normalizarConfig(b: Bruto): ConfigLoja {
  const tema = (b.tema ?? {}) as Bruto;
  const cfg = (b.configuracoes ?? {}) as Bruto;
  return {
    appNome: String(b.appNome ?? ''),
    distribuidora: String(b.distribuidora ?? ''),
    corPrimaria: txt(tema.cor_primaria),
    logoUrl: txt(tema.logo_url),
    limiteEstoqueBaixo: num(cfg.limite_estoque_baixo),
    contatoWhatsapp: txt(cfg.contato_whatsapp),
  };
}

export function normalizarCarrinho(b: Bruto): Carrinho {
  return {
    itens: lista(b.itens).map((i) => ({
      produtoId: String(i.produto_id),
      nome: String(i.nome ?? ''),
      quantidade: num(i.quantidade),
      unidadeVenda: String(i.unidade_venda ?? 'UN'),
      qtdMinima: Math.max(1, num(i.qtd_minima, 1)),
      estoque: num(i.estoque),
      imagemUrl: txt(i.imagem_url),
      precoAtual: numOuNulo(i.preco_atual),
    })),
    subtotal: num(b.subtotal),
  };
}
