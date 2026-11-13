import { UUID_INTEIRO } from '@/lib/formato/caminhos';

/**
 * Corpo do POST pedidos (CriarPedidoDto da API). O site manda só ids e escolhas: preço, total e
 * itens vêm do carrinho que a API já tem. Campos ausentes ficam fora (nada de string vazia).
 */
export interface DadosPedido {
  tipoEntrega: 'entrega' | 'retirada';
  enderecoId?: string;
  formaPagamento: 'pix' | 'cartao' | 'boleto';
  condicaoPagamento?: string;
  observacoes?: string;
  usarSaldo?: true;
}

export const MAX_OBSERVACOES = 500;

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * Validação no servidor. `condicoes` = condições de boleto da retaguarda: a API aceita qualquer
 * texto em `condicaoPagamento`, então o site só deixa passar uma das cadastradas. Nulo = inválido.
 */
export function validarPedido(corpo: unknown, condicoes: string[]): DadosPedido | null {
  const o = objeto(corpo);
  if (!o) return null;
  const { tipoEntrega, formaPagamento } = o;
  if (tipoEntrega !== 'entrega' && tipoEntrega !== 'retirada') return null;
  if (formaPagamento !== 'pix' && formaPagamento !== 'cartao' && formaPagamento !== 'boleto') return null;
  if (o.usarSaldo !== undefined && typeof o.usarSaldo !== 'boolean') return null;

  let observacoes: string | undefined;
  if (o.observacoes !== undefined && o.observacoes !== null) {
    if (typeof o.observacoes !== 'string') return null;
    const t = o.observacoes.trim();
    if (t.length > MAX_OBSERVACOES) return null;
    if (t) observacoes = t;
  }

  const dados: DadosPedido = { tipoEntrega, formaPagamento };
  if (tipoEntrega === 'entrega') {
    if (typeof o.enderecoId !== 'string' || !UUID_INTEIRO.test(o.enderecoId)) return null;
    dados.enderecoId = o.enderecoId.toLowerCase();
  }
  if (formaPagamento === 'boleto') {
    if (typeof o.condicaoPagamento !== 'string' || !condicoes.includes(o.condicaoPagamento)) return null;
    dados.condicaoPagamento = o.condicaoPagamento;
  }
  if (observacoes) dados.observacoes = observacoes;
  if (o.usarSaldo === true) dados.usarSaldo = true;
  return dados;
}

export interface PedidoCriado {
  id: string;
  numero: string;
  status: string;
  pagamento: { metodo: string | null; status: string | null } | null;
}

const txt = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** Resposta do POST pedidos → o mínimo para a tela seguir para a página do pedido. */
export function normalizarPedidoCriado(b: unknown): PedidoCriado | null {
  const o = objeto(b);
  if (!o || typeof o.id !== 'string' || !UUID_INTEIRO.test(o.id)) return null;
  const pg = objeto(o.pagamento);
  return {
    id: o.id.toLowerCase(),
    numero: typeof o.numero === 'number' ? String(o.numero) : txt(o.numero) ?? '',
    status: txt(o.status) ?? '',
    pagamento: pg ? { metodo: txt(pg.metodo), status: txt(pg.status) } : null,
  };
}
