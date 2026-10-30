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
  tid?: string;        // cartão: identificador da transação (estorno usa)
  codigo3ds?: string;  // cartão com 3DS: returnCode da autenticação
  /** Cartão: a tentativa existe na Rede e foi negada (≠ 'não existe' — desafio 3DS ainda em aberto). */
  negada?: boolean;
  /** Cartão aprovado: a Rede já cobrou (captura feita)? false = só reserva (pré-autorização). */
  capturado?: boolean;
  /** Cartão capturado: quanto foi cobrado de fato. */
  valorCapturado?: number;
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
  /** 3DS pediu desafio: o cliente precisa abrir esta URL do emissor pra se autenticar. */
  urlAutenticacao?: string;
  /** returnCode do 3DS (200 autenticado, 201 não exigido, 202 não autenticado...). */
  codigo3ds?: string;
  payload: unknown;     // resposta crua (sem dados de cartão), vai pro payload_json
}

/**
 * Dados do comprador pro 3DS 2.0 (o emissor usa na análise de risco). Vêm do
 * aparelho (tela, idioma, fuso), da requisição (IP, navegador) e do cadastro.
 */
export interface Contexto3ds {
  ip: string;
  userAgent: string;
  dispositivo: {
    profundidadeCor: number;
    altura: number;
    largura: number;
    idioma: string;
    fusoHoras: number; // UTC - hora local, em horas (Recife = 3)
  };
  cobranca: {
    endereco: string;
    cidade: string;
    cep: string;
    uf: string;
    email: string;
    telefone: string;
  };
  urlSucesso: string;
  urlFalha: string;
}

export interface ResultadoEstorno {
  /** concluido = dinheiro devolvido (359/355); solicitado = Rede aceitou e processa em D+1 (360); falhou = recusado. */
  status: 'concluido' | 'solicitado' | 'falhou';
  codigo: string;
  mensagem: string;
  refundId?: string;
  /** Falha passageira (rede fora, 368/370): o worker tenta de novo. */
  tentarDeNovo?: boolean;
  payload: unknown;
}

export interface ResultadoCaptura {
  ok: boolean;
  codigo: string;
  mensagem: string;
  /** Falha passageira (Rede fora): o worker tenta de novo. */
  tentarDeNovo?: boolean;
  payload: unknown;
}

export interface ConfigPreAutorizacao {
  /** Liga a reserva no checkout + cobrança do valor da NF-e no faturamento. */
  ativa: boolean;
  /** Prazo da Rede pra cobrar a reserva antes dela cair (confirmar com a Rede pro ramo do PV). */
  prazoHoras: number;
  /** Quanto antes de vencer a reserva o sistema cobra o valor cheio, mesmo sem NF-e (rede de segurança). */
  folgaHoras: number;
}

export interface ProvedorCartao extends ProvedorPagamento {
  readonly metodo: 'cartao';
  /** 3DS ligado na config do provedor: o checkout precisa mandar o Contexto3ds. */
  readonly usa3ds: boolean;
  /** Pré-autorização (null = desligada: cobra tudo na hora). */
  readonly preAutorizacao: ConfigPreAutorizacao | null;
  /** Referência nova e válida no provedor (cada tentativa de cobrança usa uma). */
  novaRef(numeroPedido: number): string;
  /**
   * Autoriza; `capturar` false = só reserva o valor no limite (pré-autorização).
   * Recusa do emissor NÃO é exceção: vem em aprovado=false.
   */
  cobrar(ref: string, valor: number, cartao: DadosCartao, ctx3ds?: Contexto3ds, opts?: { capturar?: boolean }): Promise<ResultadoCartao>;
  /** Cobra (total ou parcial) uma reserva aprovada. */
  capturar(tid: string, valor: number): Promise<ResultadoCaptura>;
  /** Cancela uma transação: estorno se cobrada, libera o limite se só reservada. */
  estornar(tid: string, valor: number): Promise<ResultadoEstorno>;
}

export function ehProvedorCartao(p: ProvedorPagamento): p is ProvedorCartao {
  return p.metodo === 'cartao';
}
