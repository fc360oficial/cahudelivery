/**
 * Contrato único de integração com ERPs (Ports & Adapters).
 * O núcleo do Fluxo Commerce só conhece esta interface — nunca um ERP específico.
 * Novo ERP suportado = nova implementação deste contrato, sem tocar no núcleo.
 */
import type { EnderecoEntrega, FormaPagamento, PedidoStatus } from '@fluxo/shared-types';

export interface ProdutoErp {
  erpProdutoId: string;
  sku: string;
  ean?: string;
  nome: string;
  descricao?: string;
  categoriaErpId?: string;
  marcaErpId?: string;
  unidadeVenda: string;
  qtdPorEmbalagem: number;
  ativo: boolean;
  atualizadoEm?: Date;
}

export interface PrecoErp {
  erpProdutoId: string;
  erpTabelaId?: string; // ausente = tabela padrão
  preco: number;
}

export interface EstoqueErp {
  erpProdutoId: string;
  quantidade: number;
}

export interface ClienteErp {
  erpClienteId: string;
  documento: string;
  razaoSocial?: string;
  nomeFantasia: string;
  email?: string;
  telefone?: string;
  erpTabelaPrecoId?: string;
  bloqueado: boolean;
}

export interface PedidoParaErp {
  /** Chave de idempotência: id do pedido no Fluxo. O adaptador NUNCA cria duas vezes o mesmo. */
  fluxoPedidoId: string;
  erpClienteId: string;
  formaPagamento: FormaPagamento;
  tipoEntrega: 'entrega' | 'retirada';
  observacoes?: string;
  /** Ausente quando tipoEntrega = 'retirada' (cliente busca na distribuidora). */
  enderecoEntrega?: EnderecoEntrega;
  itens: Array<{
    erpProdutoId: string;
    quantidade: number;
    precoUnit: number;
  }>;
}

export interface StatusPedidoErp {
  erpPedidoId: string;
  status: PedidoStatus;
  detalhe?: string;
}

export interface NotaFiscalErp {
  numeroNf: string;
  chaveAcesso?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  emitidaEm?: Date;
}

export interface CobrancaErp {
  tipo: FormaPagamento;
  linhaDigitavel?: string;
  pixCopiaCola?: string;
  pdfUrl?: string;
  valor: number;
  vencimento?: Date;
  pagoEm?: Date;
}

export interface ResultadoTeste {
  ok: boolean;
  mensagem: string;
  latenciaMs?: number;
}

/** Capacidades declaradas — o núcleo adapta o comportamento (webhook vs polling etc.). */
export interface ErpCapacidades {
  suportaWebhook: boolean;
  suportaPrecoPorCliente: boolean;
  suportaPix: boolean;
  suportaBoleto: boolean;
  suportaSyncIncremental: boolean;
}

export interface ErpAdapter {
  readonly nome: string; // ex.: 'dlinks'
  readonly capacidades: ErpCapacidades;

  // ERP → Fluxo (sincronização; somente leitura no ERP)
  syncProdutos(desde?: Date): Promise<ProdutoErp[]>;
  syncPrecos(desde?: Date): Promise<PrecoErp[]>;
  syncEstoque(desde?: Date): Promise<EstoqueErp[]>;
  syncClientes(desde?: Date): Promise<ClienteErp[]>;

  // Fluxo → ERP
  enviarPedido(pedido: PedidoParaErp): Promise<{ erpPedidoId: string }>;

  // ERP → Fluxo (pós-pedido)
  consultarStatusPedido(erpPedidoId: string): Promise<StatusPedidoErp>;
  obterNotaFiscal(erpPedidoId: string): Promise<NotaFiscalErp | null>;
  obterCobranca(erpPedidoId: string): Promise<CobrancaErp | null>;

  testarConexao(): Promise<ResultadoTeste>;
}
