'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { EVENTO_SESSAO_EXPIROU } from '@/componentes/CarrinhoProvider';
import { caminhoEntrar } from '@/componentes/conta/api-conta';
import { retornoDoBanco } from '@/lib/checkout/cartao';
import { deveConsultar, proximaConsulta, telaDoPagamento, tempoRestante, type TelaPagamento } from '@/lib/checkout/estado-pagamento';
import type { PedidoDetalhe } from '@/lib/conta/tipos';
import { formatarDataHora } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { FormularioCartao } from './FormularioCartao';
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

const sessaoExpirou = () => {
  window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
  window.location.replace(caminhoEntrar());
};
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Texto da conferência do cartão a partir do status REAL (POST .../pagar-cartao/confirmar). Nulo = pago.
 * Pendente depois das tentativas = mesmo texto do app (pagamento_cartao_screen.dart): o formulário
 * fica liberado para tentar de novo. A consulta periódica não chama "confirmar", então nada aqui
 * promete que a página continua conferindo com o banco.
 */
function avisoDaConferencia(status: string): string | null {
  if (status === 'pago') return null;
  if (status === 'expirado') return 'O prazo deste pagamento venceu. Refaça o pedido.';
  if (status === 'creditado') return 'Valor virou crédito: o que você pagou está na sua carteira para usar no próximo pedido.';
  return 'O banco não confirmou a compra. Tente de novo, use outro cartão ou pague com PIX.';
}

/** Conferências na volta do banco: ~30 s como o app; com ?pagamento=falhou, só ~6 s (a API decide igual). */
const TENTATIVAS_CONFERENCIA = 10;
const TENTATIVAS_SE_FALHOU = 3;

/**
 * Bloco de pagamento da página do pedido. A tela sai SEMPRE do que a API devolve
 * (telaDoPagamento); enquanto espera o pagamento, consulta /api/conta/pedidos/[id] a cada 5 s
 * (recuando em falha, parando com a aba escondida ou quando o pagamento termina). Em prazo
 * encerrado ou PIX gerando a consulta tem teto (proximaConsulta): depois de 30 min para e
 * mostra "Atualizar". Com CHECKOUT_LIGADO desligado o PIX continua (só leitura), mas o cartão
 * pendente manda pagar pelo app: nada de formulário nem de conferência do 3DS pelo site.
 */
export function BlocoPagamento({ pedido, aoAtualizar, checkoutLigado, appNome }: {
  pedido: PedidoDetalhe; aoAtualizar: (p: PedidoDetalhe) => void; checkoutLigado: boolean; appNome: string;
}) {
  const [agora, setAgora] = useState(() => Date.now());
  const [semCodigo, setSemCodigo] = useState(0);
  const tela = telaDoPagamento(pedido, agora, semCodigo);
  const visivel = useAbaVisivel();
  const [parado, setParado] = useState(false);
  const consultar = deveConsultar(tela, visivel) && !parado;
  const comTeto = tela.tipo === 'prazo-encerrado' || tela.tipo === 'pix-gerando';
  const tipoAtual = useRef(tela.tipo);
  tipoAtual.current = tela.tipo;
  const esperandoDesde = useRef<number | null>(null);
  const falhas = useRef(0);
  const atualizar = useRef(aoAtualizar);
  atualizar.current = aoAtualizar;
  const router = useRouter();
  const caminho = usePathname();
  const dica = retornoDoBanco(useSearchParams().get('pagamento'));
  const [conferindo, setConferindo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const conferiu = useRef(false);

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/conta/pedidos/${pedido.id}`, { cache: 'no-store' });
      if (r.status === 401) return sessaoExpirou();
      if (r.ok) {
        setAgora(Date.now());
        atualizar.current((await r.json()) as PedidoDetalhe);
      }
    } catch {
      // a consulta periódica tenta de novo
    }
  }, [pedido.id]);

  /**
   * Volta do banco (3DS): pergunta à API o status real, por até ~30 s como o app, e recarrega o
   * pedido. O ?pagamento=ok|falhou só dispara a conferência: o resultado mostrado é o da API.
   */
  const conferirCartao = useCallback(async (tentativas = TENTATIVAS_CONFERENCIA) => {
    setConferindo(true);
    setAviso(null);
    let status = 'pendente';
    for (let i = 0; i < tentativas; i++) {
      try {
        const r = await fetch(`/api/conta/pedidos/${pedido.id}/pagar-cartao/confirmar`, { method: 'POST' });
        if (r.status === 401) return sessaoExpirou();
        const j = (await r.json().catch(() => null)) as { status?: unknown } | null;
        if (r.ok && typeof j?.status === 'string') status = j.status;
        else if (r.status === 404) { status = 'desconhecido'; break; }
      } catch {
        // sem rede: tenta de novo na próxima volta
      }
      if (status !== 'pendente' || i === tentativas - 1) break;
      await esperar(3000);
    }
    await recarregar();
    setConferindo(false);
    setAviso(avisoDaConferencia(status));
  }, [pedido.id, recarregar]);

  const ehCartao = pedido.pagamento?.metodo === 'cartao';
  useEffect(() => {
    if (!dica || conferiu.current) return;
    conferiu.current = true;
    router.replace(caminho, { scroll: false }); // tira a dica da URL: recarregar a página não repete
    // A dica só encurta a espera; quem decide é sempre o status que a API devolve.
    if (ehCartao && checkoutLigado) void conferirCartao(dica === 'falhou' ? TENTATIVAS_SE_FALHOU : TENTATIVAS_CONFERENCIA);
  }, [dica, ehCartao, checkoutLigado, caminho, router, conferirCartao]);

  // Desde quando a tela está em prazo encerrado / PIX gerando (base do teto da consulta).
  useEffect(() => {
    if (comTeto) {
      esperandoDesde.current ??= Date.now();
    } else {
      esperandoDesde.current = null;
      setParado(false);
    }
  }, [comTeto]);

  const atualizarAgora = () => {
    esperandoDesde.current = Date.now();
    falhas.current = 0;
    setParado(false);
    void recarregar();
  };

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
    let espera: ReturnType<typeof setTimeout> | undefined;
    const agendar = (tipo: TelaPagamento['tipo']) => {
      const desde = esperandoDesde.current;
      const ms = proximaConsulta(falhas.current, tipo, desde === null ? 0 : Date.now() - desde);
      if (ms === null) setParado(true); // teto: para e mostra "Atualizar"
      else espera = setTimeout(rodada, ms);
    };
    const rodada = async () => {
      let tipo = tipoAtual.current;
      try {
        const r = await fetch(`/api/conta/pedidos/${pedido.id}`, { cache: 'no-store' });
        if (!vivo) return;
        if (r.status === 401) return sessaoExpirou();
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as PedidoDetalhe;
        if (!vivo) return;
        falhas.current = 0;
        const agoraMs = Date.now();
        tipo = telaDoPagamento(dados, agoraMs).tipo;
        // PIX pendente ainda sem código válido: conta as consultas (o limite vira "indisponível").
        setSemCodigo((n) => (tipo === 'pix-gerando' ? n + 1 : 0));
        setAgora(agoraMs);
        atualizar.current(dados);
      } catch {
        falhas.current += 1; // sem acelerar em erro: a próxima rodada espera mais
      }
      if (vivo) agendar(tipo);
    };
    agendar(tipoAtual.current);
    return () => { vivo = false; clearTimeout(espera); };
  }, [consultar, pedido.id]);

  const cartao = (t: Extract<TelaPagamento, { tipo: 'cartao' }>) => (
    <Quadro tom="alerta" titulo={`Pague ${preco(t.valor)} com cartão de crédito`}>
      {tempoRestante(t.expiraEm, agora) && <p className={estilos.prazo} role="timer" aria-live="off">Prazo para pagar: {tempoRestante(t.expiraEm, agora)}</p>}
      {aviso && <p className={estilos.avisoCartao} role="alert">{aviso}</p>}
      {!checkoutLigado ? (
        <p>Pague com cartão pelo app {appNome}</p>
      ) : conferindo ? (
        <p role="status">Conferindo o pagamento com o banco…</p>
      ) : (
        <>
          <FormularioCartao pedidoId={pedido.id} valor={t.valor} recarregar={() => void recarregar()} aoSessaoExpirar={sessaoExpirou} />
          <div>
            <button type="button" className={estilos.ligacao} onClick={() => void conferirCartao()}>Já confirmei a compra no banco</button>
          </div>
        </>
      )}
      <p className={estilos.dica}>Se não pagar dentro do prazo, o pedido é cancelado sozinho, sem cobrança.</p>
    </Quadro>
  );

  return (
    <>
      {conferindo && tela.tipo !== 'cartao' && <p className={estilos.dica} role="status">Conferindo o pagamento com o banco…</p>}
      {aviso && tela.tipo !== 'cartao' && tela.tipo !== 'pago' && tela.tipo !== 'reservado' && tela.tipo !== 'creditado' && (
        <p className={estilos.avisoCartao} role="alert">{aviso}</p>
      )}
      <Tela tela={tela} pedidoId={pedido.id} agora={agora} cartao={cartao} />
      {parado && comTeto && (
        <div className={estilos.parado}>
          <button type="button" className={estilos.copiar} onClick={atualizarAgora}>Atualizar</button>
          <p className={estilos.dica} role="status">A página parou de conferir sozinha. Toque em Atualizar para ver a situação agora.</p>
        </div>
      )}
    </>
  );
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
          <p>Não foi possível carregar a situação do pagamento. Atualize a página do pedido; se continuar assim, fale com a distribuidora.</p>
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
