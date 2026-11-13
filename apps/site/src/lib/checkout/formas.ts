/**
 * Formas de pagamento do checkout, com os textos do app (checkout_screen.dart › _formasConhecidas).
 * Quais aparecem vem da config 'formas_pagamento' da retaguarda; quem aceita ou recusa de verdade
 * é a API no POST pedidos.
 */
export type CodigoForma = 'pix' | 'cartao' | 'boleto';

export interface FormaPagamento {
  codigo: CodigoForma;
  titulo: string;
  descricao: string;
  /** Texto do quadro informativo quando a forma está escolhida. */
  aviso: string;
  /** Pago agora pelo site (PIX, cartão online) em vez de na entrega/faturamento. */
  online: boolean;
}

const PIX: FormaPagamento = {
  codigo: 'pix', titulo: 'PIX', online: true,
  descricao: 'Pague na hora pelo QR Code ou copia e cola',
  aviso: 'O código PIX aparece assim que você confirmar. O pedido segue para a distribuidora depois do pagamento (você tem 30 minutos).',
};

const CARTAO_NA_ENTREGA: FormaPagamento = {
  codigo: 'cartao', titulo: 'Cartão na entrega', online: false,
  descricao: 'Crédito ou débito na maquininha, ao receber o pedido',
  aviso: 'Você paga na maquininha do entregador quando o pedido chegar. Nada é cobrado agora.',
};

/** Com 'cartao_online' ligado na retaguarda, o cartão deixa de ser maquininha e é pago aqui. */
const CARTAO_ONLINE: FormaPagamento = {
  codigo: 'cartao', titulo: 'Cartão de crédito', online: true,
  descricao: 'Pague agora pelo site, com aprovação na hora',
  aviso: 'Você informa os dados do cartão depois de confirmar. O pedido segue para a distribuidora assim que o pagamento for aprovado (você tem 30 minutos).',
};

const BOLETO: FormaPagamento = {
  codigo: 'boleto', titulo: 'Boleto', online: false,
  descricao: 'Boleto emitido junto com a nota fiscal',
  aviso: 'O boleto é gerado pela distribuidora no faturamento do pedido. Você acompanha tudo em Meus pedidos.',
};

/** Ordem do app (PIX, cartão, boleto). Nenhuma forma conhecida ligada = só PIX, como no app. */
export function formasDePagamento(config: { formasPagamento: string[]; cartaoOnline: boolean }): FormaPagamento[] {
  const ligadas = new Set(config.formasPagamento);
  const conhecidas = [PIX, config.cartaoOnline ? CARTAO_ONLINE : CARTAO_NA_ENTREGA, BOLETO];
  const lista = conhecidas.filter((f) => ligadas.has(f.codigo));
  return lista.length > 0 ? lista : [PIX];
}

const centavos = (v: number) => Math.round(v * 100) / 100;

/** "Usar meu saldo": abate o menor entre o saldo e o subtotal (a mesma conta do POST pedidos). */
export function saldoAplicado(e: { saldo: number; subtotal: number; usar: boolean }): { aplicado: number; restante: number } {
  const subtotal = Number.isFinite(e.subtotal) && e.subtotal > 0 ? e.subtotal : 0;
  const saldo = Number.isFinite(e.saldo) && e.saldo > 0 ? e.saldo : 0;
  const aplicado = e.usar ? centavos(Math.min(saldo, subtotal)) : 0;
  return { aplicado, restante: centavos(subtotal - aplicado) };
}
