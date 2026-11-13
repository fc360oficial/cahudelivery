/**
 * Máquina de estados do bloco de pagamento da página do pedido. Mesmos estados e textos do
 * BlocoPix do app (apps/mobile/lib/widgets/bloco_pix.dart). Tudo sai do que a API devolve no
 * GET pedidos/:id: nenhum parâmetro de URL (p.ex. ?pagamento=ok do 3DS) muda o que aparece aqui.
 */
export type Metodo = 'pix' | 'cartao';

export type TelaPagamento =
  | { tipo: 'nenhum' }
  | { tipo: 'pix'; copiaCola: string; valor: number | null; expiraEm: string | null }
  | { tipo: 'pix-gerando' }
  | { tipo: 'cartao'; valor: number | null; expiraEm: string | null }
  | { tipo: 'prazo-encerrado'; metodo: Metodo }
  | { tipo: 'pago'; metodo: Metodo; pagoEm: string | null }
  | { tipo: 'reservado'; valor: number | null }
  | { tipo: 'expirado'; metodo: Metodo }
  | { tipo: 'cancelado'; metodo: Metodo }
  | { tipo: 'falhou'; metodo: Metodo }
  | { tipo: 'estorno-solicitado'; valor: number | null }
  | { tipo: 'estornado'; metodo: Metodo }
  | { tipo: 'creditado' }
  | { tipo: 'indisponivel' };

export interface PedidoParaPagamento {
  status: string;
  formaPagamento: string | null;
  pagamento: {
    metodo: string | null;
    status: string | null;
    valor: number | null;
    expiraEm: string | null;
    pagoEm: string | null;
    copiaCola: string | null;
  } | null;
}

const venceu = (expiraEm: string | null, agoraMs: number): boolean => {
  if (!expiraEm) return false;
  const t = Date.parse(expiraEm);
  return Number.isFinite(t) && t <= agoraMs;
};

export function telaDoPagamento(p: PedidoParaPagamento, agoraMs: number): TelaPagamento {
  const g = p.pagamento;
  if (!g) return { tipo: 'nenhum' };
  const metodo: Metodo = g.metodo === 'cartao' ? 'cartao' : 'pix';
  switch (g.status) {
    case 'pago': return { tipo: 'pago', metodo, pagoEm: g.pagoEm };
    // Cartão com valor reservado (pré-autorização): para o cliente o pedido seguiu.
    case 'autorizado': return { tipo: 'reservado', valor: g.valor };
    case 'expirado': return { tipo: 'expirado', metodo };
    case 'cancelado': return { tipo: 'cancelado', metodo };
    case 'falhou': return { tipo: 'falhou', metodo };
    case 'estorno_solicitado': return { tipo: 'estorno-solicitado', valor: g.valor };
    case 'estornado': return { tipo: 'estornado', metodo };
    case 'creditado': return { tipo: 'creditado' };
    case 'pendente': {
      // Só pede pagamento enquanto o PEDIDO também espera por ele.
      if (p.status !== 'AGUARDANDO_PAGAMENTO') return { tipo: 'indisponivel' };
      if (venceu(g.expiraEm, agoraMs)) return { tipo: 'prazo-encerrado', metodo };
      if (metodo === 'cartao') return { tipo: 'cartao', valor: g.valor, expiraEm: g.expiraEm };
      return g.copiaCola ? { tipo: 'pix', copiaCola: g.copiaCola, valor: g.valor, expiraEm: g.expiraEm } : { tipo: 'pix-gerando' };
    }
    // Status desconhecido: nunca afirmar pago nem expirado sem saber.
    default: return { tipo: 'indisponivel' };
  }
}

const ESPERANDO = new Set<TelaPagamento['tipo']>(['pix', 'pix-gerando', 'cartao', 'prazo-encerrado']);

/** Consulta o pedido só enquanto espera o pagamento e com a aba visível. */
export function deveConsultar(tela: TelaPagamento, abaVisivel: boolean): boolean {
  return abaVisivel && ESPERANDO.has(tela.tipo);
}

const BASE_MS = 5000;
const TETO_MS = 60_000;

/** 5 s; a cada falha seguida dobra (sem acelerar em erro), até 60 s. */
export function intervaloConsulta(falhasSeguidas: number): number {
  return Math.min(TETO_MS, BASE_MS * 2 ** Math.max(0, Math.min(falhasSeguidas, 10)));
}

/** "mm:ss" que falta até `expiraEm` (00:00 quando passou); nulo sem prazo legível. */
export function tempoRestante(expiraEm: string | null, agoraMs: number): string | null {
  if (!expiraEm) return null;
  const t = Date.parse(expiraEm);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((t - agoraMs) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
