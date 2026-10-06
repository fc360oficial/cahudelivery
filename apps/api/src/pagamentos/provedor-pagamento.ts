/**
 * Contrato de provedor de pagamento online. O núcleo (PagamentosService) só
 * conhece isto; Itaú PIX é o primeiro provedor, e.Rede (cartão) entra depois
 * implementando a mesma interface.
 */

export interface NovaCobranca {
  ref: string;            // identificador nosso, vira txid/pedido no provedor
  valor: number;          // reais
  expiracaoSegundos: number;
  descricao: string;      // "Pedido #123 CAHU Delivery"
  pagador?: { documento: string; nome: string };
}

export interface CobrancaCriada {
  ref: string;
  copiaCola: string | null;   // BR Code; null pra métodos sem QR (cartão)
  expiraEm: Date;
  payload: unknown;           // resposta crua do provedor, vai pro payload_json
}

export type SituacaoStatus = 'pendente' | 'pago' | 'expirado' | 'cancelado';

export interface SituacaoCobranca {
  status: SituacaoStatus;
  valorPago?: number;
  pagoEm?: Date;
  payload: unknown;
}

export interface PagamentoRecebido {
  ref: string;
  valorPago: number;
  pagoEm: Date;
}

export interface ProvedorPagamento {
  readonly nome: string;
  readonly metodo: 'pix' | 'cartao';
  criarCobranca(p: NovaCobranca): Promise<CobrancaCriada>;
  consultar(ref: string): Promise<SituacaoCobranca>;
  /** Extrai as confirmações de um corpo de webhook. Corpo inválido => []. */
  tratarWebhook(corpo: string): PagamentoRecebido[];
}

/** Dados do cartão só transitam: nunca são gravados nem logados. */
export interface DadosCartao {
  numero: string;       // só dígitos
  nome: string;         // como impresso no cartão
  validadeMes: number;  // 1-12
  validadeAno: number;  // 4 dígitos
  cvv: string;
}

export interface ResultadoCartao {
  aprovado: boolean;
  ref: string;          // referência desta tentativa no provedor
  codigo: string;       // returnCode do provedor ('00' = aprovado)
  mensagem: string;     // amigável, mostrada ao cliente quando recusado
  tid?: string;
  autorizacao?: string;
  payload: unknown;     // resposta crua (sem dados de cartão), vai pro payload_json
}

export interface ProvedorCartao extends ProvedorPagamento {
  readonly metodo: 'cartao';
  /** Referência nova e válida no provedor (cada tentativa de cobrança usa uma). */
  novaRef(numeroPedido: number): string;
  /** Autoriza com captura automática. Recusa do emissor NÃO é exceção: vem em aprovado=false. */
  cobrar(ref: string, valor: number, cartao: DadosCartao): Promise<ResultadoCartao>;
}

export function ehProvedorCartao(p: ProvedorPagamento): p is ProvedorCartao {
  return p.metodo === 'cartao';
}
