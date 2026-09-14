/**
 * Tipos compartilhados entre API, retaguarda e adaptadores.
 * Fonte da verdade dos enums que existem no banco (11 - SQL/tenant).
 */

export const PEDIDO_STATUS = [
  'RECEBIDO',
  'ENVIADO_ERP',
  'FATURADO',
  'EM_SEPARACAO',
  'SAIU_ENTREGA',
  'ENTREGUE',
  'FALHA_INTEGRACAO',
  'CANCELADO',
] as const;
export type PedidoStatus = (typeof PEDIDO_STATUS)[number];

/** 'cartao' = crédito/débito na maquininha na entrega (sem gateway online por enquanto). */
export type FormaPagamento = 'boleto' | 'pix' | 'cartao';
export type UnidadeVenda = 'UN' | 'CX' | 'FD' | 'PC' | 'KG';
export type ClienteStatus = 'pendente' | 'aprovado' | 'bloqueado';

export interface EnderecoEntrega {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
}
