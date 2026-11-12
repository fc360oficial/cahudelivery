export interface Imagem { url: string; miniatura: string | null }

export interface Produto {
  id: string;
  sku: string | null;
  ean: string | null;
  nome: string;
  descricao: string | null;
  unidadeVenda: string;
  qtdPorEmbalagem: number;
  qtdMinima: number;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
  dataValidade: string | null;
  marca: string | null;
  marcaId: string | null;
  categoria: string | null;
  categoriaId: string | null;
  estoque: number;
  precoTabela: number | null;
  precoPromocional: number | null;
  /** Preço final da embalagem de venda (promoção vence tabela). Nulo = sem preço cadastrado. */
  preco: number | null;
  imagens: Imagem[];
}

export interface Banner {
  id: string;
  titulo: string | null;
  imagemUrl: string;
  destinoTipo: string | null;
  destinoId: string | null;
}

export interface Patrocinador {
  tipo: 'patrocinador';
  id: string;
  nome: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  produtos: Produto[];
}

export interface PrateleiraCategoria {
  tipo: 'categoria';
  categoriaId: string;
  nome: string;
  produtos: Produto[];
}

export type Prateleira = PrateleiraCategoria | Patrocinador;

export interface Home {
  banners: Banner[];
  promocoes: Produto[];
  maisVendidos: Produto[];
  vencimentoProximo: Produto[];
  prateleiras: Prateleira[];
  patrocinadoresTopo: Patrocinador[];
  patrocinadoresOfertas: Patrocinador[];
}

export interface Categoria {
  id: string;
  paiId: string | null;
  nome: string;
  imagemUrl: string | null;
}

export interface Marca { id: string; nome: string; produtos: number }

export interface ConfigLoja {
  appNome: string;
  distribuidora: string;
  corPrimaria: string | null;
  logoUrl: string | null;
  limiteEstoqueBaixo: number;
  contatoWhatsapp: string | null;
}

export interface PaginaProdutos { dados: Produto[]; pagina: number; temMais: boolean }

export interface Relacionados { similares: Produto[]; pecaTambem: Produto[] }

export interface ItemCarrinho {
  produtoId: string;
  nome: string;
  quantidade: number;
  unidadeVenda: string;
  qtdMinima: number;
  estoque: number;
  imagemUrl: string | null;
  precoAtual: number | null;
}

export interface Carrinho { itens: ItemCarrinho[]; subtotal: number }
