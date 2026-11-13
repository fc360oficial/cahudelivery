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

/** Consultas seguidas com PIX pendente sem código válido (~30 s) antes de desistir de "Gerando…". */
export const LIMITE_CONSULTAS_SEM_CODIGO = 6;

/**
 * `consultasSemCodigo`: quantas consultas seguidas já vieram com o PIX pendente sem código
 * (ausente ou recusado pelo normalizador). Passou do limite: indisponível, com a orientação de
 * falar com a distribuidora, em vez de "Gerando código PIX…" para sempre.
 */
export function telaDoPagamento(p: PedidoParaPagamento, agoraMs: number, consultasSemCodigo = 0): TelaPagamento {
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
      if (g.copiaCola) return { tipo: 'pix', copiaCola: g.copiaCola, valor: g.valor, expiraEm: g.expiraEm };
      return consultasSemCodigo >= LIMITE_CONSULTAS_SEM_CODIGO ? { tipo: 'indisponivel' } : { tipo: 'pix-gerando' };
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

/** Estados sem prazo correndo: a espera pode não ter fim, então a consulta tem teto. */
const COM_TETO = new Set<TelaPagamento['tipo']>(['prazo-encerrado', 'pix-gerando']);
const LENTO_APOS_MS = 10 * 60_000;
const PARAR_APOS_MS = 30 * 60_000;

/**
 * Espera até a próxima consulta. Em `prazo-encerrado` ou `pix-gerando`: normal nos primeiros
 * 10 min, depois a cada 60 s; passados 30 min, nulo = parar (a tela mostra "Atualizar").
 * `esperandoHaMs` = há quanto tempo a tela está nesses estados.
 */
export function proximaConsulta(falhasSeguidas: number, tela: TelaPagamento['tipo'], esperandoHaMs: number): number | null {
  const normal = intervaloConsulta(falhasSeguidas);
  if (!COM_TETO.has(tela)) return normal;
  if (esperandoHaMs >= PARAR_APOS_MS) return null;
  if (esperandoHaMs >= LENTO_APOS_MS) return Math.max(normal, TETO_MS);
  return normal;
}

/** "mm:ss" que falta até `expiraEm` (00:00 quando passou); nulo sem prazo legível. */
export function tempoRestante(expiraEm: string | null, agoraMs: number): string | null {
  if (!expiraEm) return null;
  const t = Date.parse(expiraEm);
  if (!Number.isFinite(t)) return null;
  const s = Math.max(0, Math.floor((t - agoraMs) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
