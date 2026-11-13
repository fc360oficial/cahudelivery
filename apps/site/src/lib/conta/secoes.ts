export interface Secao { caminho: string; rotulo: string }

export const VISAO_GERAL: Secao = { caminho: '/conta', rotulo: 'Visão geral' };

/** Ordem do menu "Olá, <nome>" e da coluna lateral da área do cliente. */
export const SECOES_MENU: Secao[] = [
  { caminho: '/conta/pedidos', rotulo: 'Meus pedidos' },
  { caminho: '/conta/notas', rotulo: 'Notas fiscais' },
  { caminho: '/conta/dados', rotulo: 'Dados cadastrais' },
  { caminho: '/conta/enderecos', rotulo: 'Endereços' },
  { caminho: '/conta/credito', rotulo: 'Crédito' },
  { caminho: '/conta/carteira', rotulo: 'Carteira' },
];

/** Seção em que o caminho está (subpáginas contam: /conta/pedidos/<id> é "Meus pedidos"). */
export function secaoAtual(caminho: string | null): Secao | null {
  if (!caminho) return null;
  if (caminho === VISAO_GERAL.caminho) return VISAO_GERAL;
  return SECOES_MENU.find((s) => caminho === s.caminho || caminho.startsWith(`${s.caminho}/`)) ?? null;
}
