/** Formatos que as rotas /api/conta/* devolvem ao navegador (já normalizados). */

export interface Perfil {
  tipo: 'CPF' | 'CNPJ' | null;
  documento: string;
  razaoSocial: string | null;
  nomeFantasia: string;
  email: string | null;
  telefone: string | null;
  status: string | null;
}

export interface Endereco {
  id: string;
  apelido: string | null;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  padrao: boolean;
}

export interface EnderecoEntrega {
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
}

/** Pagamento online (PIX/cartão) do pedido. Sem o copia-e-cola: pagar pelo site é outra etapa. */
export interface PagamentoOnline {
  metodo: string | null;
  status: string | null;
  valor: number | null;
  expiraEm: string | null;
  pagoEm: string | null;
}

export interface PedidoResumo {
  id: string;
  numero: string;
  status: string;
  formaPagamento: string | null;
  total: number;
  criadoEm: string | null;
  pagamento: PagamentoOnline | null;
}

export interface Pagina<T> { dados: T[]; pagina: number; temMais: boolean }

export interface ItemPedido {
  produtoId: string | null;
  descricao: string;
  quantidade: number;
  precoUnit: number | null;
  total: number | null;
  /** Foto do catálogo, completada pela rota (o pedido não guarda imagem). */
  imagemUrl: string | null;
}

export interface EventoPedido { status: string; detalhe: string | null; em: string | null }

/** Cobrança do ERP (boleto/PIX). Sem URL de PDF nem copia-e-cola. */
export interface Cobranca {
  tipo: string | null;
  valor: number | null;
  vencimento: string | null;
  pagoEm: string | null;
  linhaDigitavel: string | null;
}

/** Nota do pedido: as URLs assinadas ficam no servidor; o navegador só sabe se o arquivo existe. */
export interface NotaPedido {
  numero: string;
  chaveAcesso: string | null;
  emitidaEm: string | null;
  temDanfe: boolean;
  temXml: boolean;
}

export interface PedidoDetalhe {
  id: string;
  numero: string;
  status: string;
  formaPagamento: string | null;
  condicaoPagamento: string | null;
  tipoEntrega: 'entrega' | 'retirada';
  subtotal: number;
  desconto: number;
  saldoUsado: number;
  total: number;
  observacoes: string | null;
  criadoEm: string | null;
  endereco: EnderecoEntrega | null;
  itens: ItemPedido[];
  eventos: EventoPedido[];
  cobranca: Cobranca | null;
  nota: NotaPedido | null;
  pagamento: PagamentoOnline | null;
}

export interface NotaFiscal {
  pedidoId: string;
  numeroPedido: string;
  total: number;
  numero: string;
  chaveAcesso: string | null;
  emitidaEm: string | null;
  temDanfe: boolean;
  temXml: boolean;
}

export interface MovimentoCarteira { id: string; valor: number; motivo: string; criadoEm: string | null }

export interface Carteira { saldo: number; movimentos: MovimentoCarteira[] }

/** GET credito só diz se há solicitação de análise pendente (limite/títulos não são expostos pela API). */
export interface Credito { pendente: boolean }

export interface ResumoConta {
  perfil: Perfil;
  ultimoPedido: PedidoResumo | null;
  credito: Credito | null;
  carteira: { saldo: number } | null;
}
