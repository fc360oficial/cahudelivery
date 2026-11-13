'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EVENTO_SESSAO_EXPIROU } from '@/componentes/CarrinhoProvider';
import { caminhoEntrar } from '@/componentes/conta/api-conta';
import { deveConsultar, intervaloConsulta, telaDoPagamento, tempoRestante, type TelaPagamento } from '@/lib/checkout/estado-pagamento';
import type { PedidoDetalhe } from '@/lib/conta/tipos';
import { formatarDataHora } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import estilos from './BlocoPagamento.module.css';

const preco = (v: number | null) => (v != null ? formatarPreco(v) : '—');
const nomeMetodo = (m: 'pix' | 'cartao') => (m === 'cartao' ? 'Cartão' : 'PIX');

/** Aba visível? (consulta só com a aba à vista, como pede o brief) */
function useAbaVisivel(): boolean {
  const [visivel, setVisivel] = useState(true);
  useEffect(() => {
    const atualizar = () => setVisivel(document.visibilityState === 'visible');
    atualizar();
    document.addEventListener('visibilitychange', atualizar);
    return () => document.removeEventListener('visibilitychange', atualizar);
  }, []);
  return visivel;
}

/**
 * Bloco de pagamento da página do pedido. A tela sai SEMPRE do que a API devolve
 * (telaDoPagamento); enquanto espera o pagamento, consulta /api/conta/pedidos/[id] a cada 5 s
 * (recuando em falha, parando com a aba escondida ou quando o pagamento termina).
 */
export function BlocoPagamento({ pedido, aoAtualizar, cartao }: {
  pedido: PedidoDetalhe;
  aoAtualizar: (p: PedidoDetalhe) => void;
  /** Conteúdo do pagamento com cartão (formulário), quando a tela pede cartão. */
  cartao?: (tela: Extract<TelaPagamento, { tipo: 'cartao' }>) => ReactNode;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const tela = telaDoPagamento(pedido, agora);
  const visivel = useAbaVisivel();
  const consultar = deveConsultar(tela, visivel);
  const falhas = useRef(0);
  const atualizar = useRef(aoAtualizar);
  atualizar.current = aoAtualizar;

  // Relógio da contagem regressiva (só enquanto há prazo correndo).
  const temPrazo = tela.tipo === 'pix' || tela.tipo === 'cartao';
  useEffect(() => {
    if (!temPrazo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [temPrazo]);

  // Consulta periódica do pedido.
  useEffect(() => {
    if (!consultar) return;
    let vivo = true;
    let espera: ReturnType<typeof setTimeout>;
    const rodada = async () => {
      try {
        const r = await fetch(`/api/conta/pedidos/${pedido.id}`, { cache: 'no-store' });
        if (!vivo) return;
        if (r.status === 401) {
          window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
          window.location.replace(caminhoEntrar());
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as PedidoDetalhe;
        if (!vivo) return;
        falhas.current = 0;
        setAgora(Date.now());
        atualizar.current(dados);
      } catch {
        falhas.current += 1; // sem acelerar em erro: a próxima rodada espera mais
      }
      if (vivo) espera = setTimeout(rodada, intervaloConsulta(falhas.current));
    };
    espera = setTimeout(rodada, intervaloConsulta(falhas.current));
    return () => { vivo = false; clearTimeout(espera); };
  }, [consultar, pedido.id]);

  return <Tela tela={tela} pedidoId={pedido.id} agora={agora} cartao={cartao} />;
}

function Quadro({ tom, titulo, children }: { tom: 'ok' | 'alerta' | 'perigo' | 'neutro'; titulo: string; children?: ReactNode }) {
  return (
    <section className={`${estilos.quadro} ${estilos[tom]}`} aria-labelledby="titulo-pagamento" aria-live="polite">
      <h2 id="titulo-pagamento">{titulo}</h2>
      {children}
    </section>
  );
}

function Tela({ tela, pedidoId, agora, cartao }: {
  tela: TelaPagamento; pedidoId: string; agora: number;
  cartao?: (tela: Extract<TelaPagamento, { tipo: 'cartao' }>) => ReactNode;
}) {
  switch (tela.tipo) {
    case 'nenhum':
      return null;
    case 'pix':
      return <BlocoPix tela={tela} pedidoId={pedidoId} agora={agora} />;
    case 'pix-gerando':
      return <Quadro tom="neutro" titulo="Gerando código PIX…"><p>Isso leva só alguns segundos.</p></Quadro>;
    case 'cartao':
      return cartao ? <>{cartao(tela)}</> : (
        <Quadro tom="alerta" titulo="Aguardando pagamento com cartão">
          <p>Se não pagar dentro do prazo, o pedido é cancelado sozinho, sem cobrança.</p>
        </Quadro>
      );
    case 'prazo-encerrado':
      return (
        <Quadro tom="alerta" titulo="Prazo de pagamento encerrado">
          <p>O prazo para pagar este pedido acabou. Se você pagou agora há pouco, aguarde: a confirmação aparece aqui sozinha.</p>
        </Quadro>
      );
    case 'pago':
      return (
        <Quadro tom="ok" titulo="Pagamento confirmado">
          <p>{tela.metodo === 'cartao' ? 'Pago no cartão' : 'PIX pago'}{tela.pagoEm ? ` em ${formatarDataHora(tela.pagoEm)}` : ''}. O pedido seguiu para a distribuidora.</p>
        </Quadro>
      );
    case 'reservado':
      return (
        <Quadro tom="ok" titulo="Pagamento confirmado">
          <p>Cartão aprovado: {preco(tela.valor)} ficaram reservados no limite do cartão. Você só é cobrado pelo valor da nota fiscal, no faturamento: item em falta não é cobrado.</p>
        </Quadro>
      );
    case 'expirado':
      return (
        <Quadro tom="perigo" titulo={`${nomeMetodo(tela.metodo)} expirado`}>
          <p>O prazo de pagamento acabou e o pedido foi cancelado. Para comprar estes produtos de novo, use “Repetir pedido”.</p>
        </Quadro>
      );
    case 'cancelado':
      return <Quadro tom="perigo" titulo={`${nomeMetodo(tela.metodo)} cancelado`}><p>A cobrança foi cancelada e o pedido não seguiu.</p></Quadro>;
    case 'falhou':
      return <Quadro tom="perigo" titulo={`Falha no ${nomeMetodo(tela.metodo)}`}><p>Não foi possível gerar a cobrança. Refaça o pedido.</p></Quadro>;
    case 'estorno-solicitado':
      return (
        <Quadro tom="alerta" titulo="Estorno solicitado">
          <p>Pedimos o estorno de {preco(tela.valor)} à administradora do cartão. O valor volta na fatura conforme o prazo do seu banco (em geral até 2 faturas).</p>
        </Quadro>
      );
    case 'estornado':
      return (
        <Quadro tom="ok" titulo={tela.metodo === 'cartao' ? 'Valor estornado' : 'Valor devolvido'}>
          <p>{tela.metodo === 'cartao'
            ? 'O estorno foi feito no cartão. O crédito aparece na fatura conforme o prazo do seu banco.'
            : 'Devolvemos o valor por PIX para a conta de origem.'}</p>
        </Quadro>
      );
    case 'creditado':
      return (
        <Quadro tom="ok" titulo="Valor virou crédito">
          <p>O que você pagou neste pedido está na sua carteira para usar no próximo pedido. Se preferir o dinheiro de volta, fale com a distribuidora.</p>
        </Quadro>
      );
    case 'indisponivel':
      return (
        <Quadro tom="perigo" titulo="Pagamento indisponível">
          <p>Não foi possível carregar a situação do pagamento. Atualize a página do pedido.</p>
        </Quadro>
      );
  }
}

function BlocoPix({ tela, pedidoId, agora }: { tela: Extract<TelaPagamento, { tipo: 'pix' }>; pedidoId: string; agora: number }) {
  const [copiado, setCopiado] = useState<'ok' | 'falhou' | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const restante = tempoRestante(tela.expiraEm, agora);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(tela.copiaCola);
      setCopiado('ok');
    } catch {
      // Sem permissão de área de transferência: deixa o código selecionado para Ctrl+C.
      campo.current?.select();
      setCopiado('falhou');
    }
  };

  return (
    <Quadro tom="alerta" titulo={`Pague ${preco(tela.valor)} com PIX`}>
      {restante && <p className={estilos.prazo} role="timer" aria-live="off">Expira em {restante}</p>}
      <div className={estilos.pix}>
        {/* O QR é desenhado pelo servidor do site a partir do copia-e-cola (rota autenticada). */}
        <img className={estilos.qr} src={`/api/conta/pedidos/${pedidoId}/pix-qr?v=${encodeURIComponent(tela.expiraEm ?? '')}`}
          alt="QR Code do PIX" width={220} height={220} />
        <div className={estilos.codigo}>
          <label htmlFor="pix-copia-cola">PIX copia e cola</label>
          <textarea id="pix-copia-cola" ref={campo} readOnly rows={4} value={tela.copiaCola} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={estilos.copiar} onClick={copiar}>Copiar código</button>
          <span role="status" className={estilos.dica}>
            {copiado === 'ok' ? 'Código PIX copiado!' : copiado === 'falhou' ? 'Não deu para copiar sozinho: o código está selecionado, use Ctrl+C.' : ''}
          </span>
        </div>
      </div>
      <p className={estilos.dica}>Abra o app do seu banco, escolha PIX copia e cola e cole o código. Assim que pagar, esta página muda sozinha.</p>
    </Quadro>
  );
}
