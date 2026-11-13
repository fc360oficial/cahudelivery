import { UUID_INTEIRO } from '@/lib/formato/caminhos';

/**
 * Folga para o relógio do navegador adiantado em relação ao servidor: um pedido com
 * `criado_em` até 2 minutos antes do clique ainda conta como "deste envio".
 */
export const MARGEM_RELOGIO_MS = 2 * 60 * 1000;

export interface DadosConferencia {
  /** Quantos itens o carrinho tem depois do envio; nulo = não deu para ler. */
  itensNoCarrinho: number | null;
  /** Primeira página de "Meus pedidos"; nulo = não deu para ler. */
  pedidos: { id: string; criadoEm: string | null }[] | null;
  /** Date.now() do clique em "Confirmar pedido". */
  inicioEnvio: number;
}

export type DecisaoIncerto =
  | { acao: 'ir-ao-pedido'; id: string }
  | { acao: 'meus-pedidos' }
  | { acao: 'liberar' }
  | { acao: 'indeterminado' };

/**
 * Envio do pedido sem resposta (rede caiu, tempo esgotado, 5xx): decide o que fazer sem
 * arriscar um segundo pedido. A API esvazia o carrinho na mesma transação que cria o pedido,
 * então só "carrinho ainda com os itens" libera nova tentativa.
 */
export function decidirAposIncerto({ itensNoCarrinho, pedidos, inicioEnvio }: DadosConferencia): DecisaoIncerto {
  const desde = inicioEnvio - MARGEM_RELOGIO_MS;
  let novo: { id: string; em: number } | null = null;
  for (const p of pedidos ?? []) {
    const em = p.criadoEm ? Date.parse(p.criadoEm) : NaN;
    if (!Number.isFinite(em) || em < desde || !UUID_INTEIRO.test(p.id)) continue;
    if (!novo || em > novo.em) novo = { id: p.id, em };
  }
  if (novo) return { acao: 'ir-ao-pedido', id: novo.id };
  if (itensNoCarrinho === null) return { acao: 'indeterminado' };
  if (itensNoCarrinho === 0) return { acao: 'meus-pedidos' };
  return { acao: 'liberar' };
}
