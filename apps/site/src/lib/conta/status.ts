/** Cor da etiqueta: positivo/alerta/perigo dos tokens; andamento = pedido em curso; neutro = desconhecido. */
export type Tom = 'positivo' | 'alerta' | 'perigo' | 'andamento' | 'neutro';

export interface Rotulo { rotulo: string; tom: Tom }

/** Mesmos nomes do app (apps/mobile/lib/features/orders/status_pedido.dart). */
const PEDIDO: Record<string, Rotulo> = {
  AGUARDANDO_PAGAMENTO: { rotulo: 'Aguardando pagamento', tom: 'alerta' },
  RECEBIDO: { rotulo: 'Recebido', tom: 'andamento' },
  ENVIADO_ERP: { rotulo: 'Em processamento', tom: 'andamento' },
  ABERTO: { rotulo: 'Em processamento', tom: 'andamento' },
  // O app mostra o código cru; para o cliente a falha de integração é só um pedido ainda em processamento.
  FALHA_INTEGRACAO: { rotulo: 'Em processamento', tom: 'andamento' },
  EM_FATURAMENTO: { rotulo: 'Em faturamento', tom: 'andamento' },
  FATURADO: { rotulo: 'Faturado', tom: 'andamento' },
  EM_SEPARACAO: { rotulo: 'Em separação', tom: 'andamento' },
  SAIU_ENTREGA: { rotulo: 'Saiu para entrega', tom: 'andamento' },
  ENTREGUE: { rotulo: 'Entregue', tom: 'positivo' },
  CANCELADO: { rotulo: 'Cancelado', tom: 'perigo' },
};

const desconhecido = (s: string | null | undefined): Rotulo => ({ rotulo: s || '—', tom: 'neutro' });

export function statusPedido(status: string | null | undefined): Rotulo {
  return (status && PEDIDO[status]) || desconhecido(status);
}

export const aguardaPagamento = (status: string | null | undefined) => status === 'AGUARDANDO_PAGAMENTO';

const CADASTRO: Record<string, Rotulo> = {
  aprovado: { rotulo: 'Aprovado', tom: 'positivo' },
  ativo: { rotulo: 'Aprovado', tom: 'positivo' },
  pendente: { rotulo: 'Em análise', tom: 'alerta' },
  bloqueado: { rotulo: 'Bloqueado', tom: 'perigo' },
  excluido: { rotulo: 'Excluído', tom: 'perigo' },
};

export function situacaoCadastro(status: string | null | undefined): Rotulo {
  return (status && CADASTRO[status]) || desconhecido(status);
}

const FORMAS: Record<string, string> = { boleto: 'Boleto', pix: 'PIX', cartao: 'Cartão' };

export function rotuloFormaPagamento(forma: string | null | undefined): string {
  return (forma && FORMAS[forma]) || forma || '—';
}

const PAGAMENTO: Record<string, Rotulo> = {
  pendente: { rotulo: 'Aguardando pagamento', tom: 'alerta' },
  autorizado: { rotulo: 'Pago', tom: 'positivo' },
  pago: { rotulo: 'Pago', tom: 'positivo' },
  expirado: { rotulo: 'Expirado', tom: 'perigo' },
  cancelado: { rotulo: 'Cancelado', tom: 'perigo' },
  falhou: { rotulo: 'Não aprovado', tom: 'perigo' },
  recusado: { rotulo: 'Não aprovado', tom: 'perigo' },
  estorno_solicitado: { rotulo: 'Estorno solicitado', tom: 'alerta' },
  estornado: { rotulo: 'Estornado', tom: 'neutro' },
};

export function statusPagamentoOnline(status: string | null | undefined): Rotulo {
  return (status && PAGAMENTO[status]) || desconhecido(status);
}
