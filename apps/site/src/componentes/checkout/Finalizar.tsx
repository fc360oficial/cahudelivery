'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { EVENTO_SESSAO_EXPIROU, useCarrinho } from '@/componentes/CarrinhoProvider';
import { TEXTO_EM_ANALISE } from '@/componentes/ItensCarrinho';
import { useSessao } from '@/componentes/SessaoProvider';
import { useDadosConta } from '@/componentes/conta/api-conta';
import { ENDERECO_VAZIO, FormularioEndereco } from '@/componentes/conta/Enderecos';
import { Aviso, Carregando, ErroCarga } from '@/componentes/conta/Partes';
import { barraDoMinimo } from '@/lib/checkout/minimo';
import { formasDePagamento, saldoAplicado, type CodigoForma } from '@/lib/checkout/formas';
import { MAX_OBSERVACOES } from '@/lib/checkout/pedido';
import { cadastroEmAnalise } from '@/lib/conta/status';
import type { Carteira, Endereco } from '@/lib/conta/tipos';
import { formatarCep } from '@/lib/formato/documentos';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';
import { formatarPreco } from '@/lib/formato/preco';
import conta from '@/componentes/conta/Conta.module.css';
import estilos from './Finalizar.module.css';

interface Props {
  formasPagamento: string[];
  cartaoOnline: boolean;
  cartaoEmBreve: boolean;
  condicoesBoleto: string[];
  pedidoMinimo: number | null;
  whatsapp: string | null;
}

const PASSOS = ['Entrega', 'Pagamento', 'Revisão'] as const;
const ENTRAR = '/entrar?voltar=%2Ffinalizar';
const INCERTO = 'Não deu para confirmar se o pedido foi criado. Confira em Meus pedidos antes de tentar de novo.';

type Falha = { tipo: 'recusa' | 'incerto'; mensagem: string };

/** Fechamento do pedido: entrega → pagamento → revisão → POST /api/conta/pedidos (como o checkout do app). */
export function Finalizar(props: Props) {
  const { carregado, logado } = useSessao();
  const router = useRouter();
  useEffect(() => {
    if (carregado && !logado) router.replace(ENTRAR);
  }, [carregado, logado, router]);
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <h1>Finalizar pedido</h1>
      {carregado && logado ? <Checkout {...props} /> : <Carregando />}
    </div>
  );
}

function Checkout({ formasPagamento, cartaoOnline, cartaoEmBreve, condicoesBoleto, pedidoMinimo, whatsapp }: Props) {
  const router = useRouter();
  const { status } = useSessao();
  const { carrinho, carregado: carrinhoCarregado, recarregar: recarregarCarrinho } = useCarrinho();
  const enderecos = useDadosConta<Endereco[]>('/api/conta/enderecos');
  const carteira = useDadosConta<Carteira>('/api/conta/carteira');
  const formas = useMemo(() => formasDePagamento({ formasPagamento, cartaoOnline }), [formasPagamento, cartaoOnline]);

  const [passo, setPasso] = useState(0);
  const [tipoEntrega, setTipoEntrega] = useState<'entrega' | 'retirada'>('entrega');
  const [enderecoId, setEnderecoId] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [forma, setForma] = useState<CodigoForma>(formas[0].codigo);
  const [condicao, setCondicao] = useState(condicoesBoleto[0]);
  const [usarSaldo, setUsarSaldo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const travado = useRef(false);
  const tituloPasso = useRef<HTMLHeadingElement>(null);

  // Endereço inicial: o padrão, senão o primeiro (como o app).
  const lista = enderecos.dados;
  useEffect(() => {
    if (!lista || lista.length === 0) return;
    setEnderecoId((atual) => (atual && lista.some((e) => e.id === atual) ? atual : (lista.find((e) => e.padrao) ?? lista[0]).id));
  }, [lista]);

  const saldo = carteira.dados?.saldo ?? 0; // saldo é auxiliar: falhou, segue sem a opção (como o app)
  const subtotal = carrinho.subtotal;
  const { aplicado, restante } = saldoAplicado({ saldo, subtotal, usar: usarSaldo });
  const formaAtual = formas.find((f) => f.codigo === forma) ?? formas[0];
  const endereco = lista?.find((e) => e.id === enderecoId) ?? null;
  const emAnalise = cadastroEmAnalise(status);
  const barra = barraDoMinimo(subtotal, pedidoMinimo);

  const irPara = (n: number) => {
    setFalha(null);
    setPasso(n);
    requestAnimationFrame(() => tituloPasso.current?.focus());
  };

  const podeContinuar = passo === 0 ? (tipoEntrega === 'retirada' || (!!endereco && !cadastrando)) : true;

  const confirmar = async () => {
    if (travado.current) return; // duplo clique: um envio só, e nunca reenvio automático
    travado.current = true;
    setEnviando(true);
    setFalha(null);
    const corpo = {
      tipoEntrega,
      ...(tipoEntrega === 'entrega' ? { enderecoId } : {}),
      formaPagamento: forma,
      ...(forma === 'boleto' ? { condicaoPagamento: condicao } : {}),
      ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
      ...(usarSaldo && saldo > 0 ? { usarSaldo: true } : {}),
    };
    let r: Response;
    try {
      r = await fetch('/api/conta/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    } catch {
      travado.current = false;
      setEnviando(false);
      setFalha({ tipo: 'incerto', mensagem: INCERTO });
      return;
    }
    const j = (await r.json().catch(() => null)) as { id?: unknown; mensagem?: unknown } | null;
    if (r.status === 401) {
      window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIROU));
      router.replace(ENTRAR);
      return;
    }
    if (r.ok && typeof j?.id === 'string' && UUID_INTEIRO.test(j.id)) {
      setConcluido(true);
      router.replace(`/conta/pedidos/${j.id}?novo=1`);
      recarregarCarrinho();
      return; // fica travado: o pedido já existe
    }
    travado.current = false;
    setEnviando(false);
    if (r.ok || r.status >= 500) setFalha({ tipo: 'incerto', mensagem: INCERTO });
    else setFalha({ tipo: 'recusa', mensagem: typeof j?.mensagem === 'string' && j.mensagem ? j.mensagem : 'Não foi possível fechar o pedido.' });
  };

  if (concluido) return <Carregando texto="Pedido feito! Abrindo o pedido…" />;
  if (!carrinhoCarregado) return <Carregando texto="Carregando seu carrinho…" />;
  if (carrinho.itens.length === 0) {
    return (
      <div className={conta.estado}>
        <strong>Seu carrinho está vazio</strong>
        <Link href="/" className={conta.secundario}>Ver produtos</Link>
      </div>
    );
  }

  const botaoAvancar = passo < 2 ? (
    <button type="button" className={conta.primario} onClick={() => irPara(passo + 1)} disabled={!podeContinuar}>Continuar</button>
  ) : (
    <button type="button" className={conta.primario} onClick={confirmar} disabled={enviando || emAnalise}>
      {enviando ? 'Enviando pedido…' : 'Confirmar pedido'}
    </button>
  );

  return (
    <>
      <ol className={estilos.passos} aria-label="Etapas">
        {PASSOS.map((nome, i) => (
          <li key={nome} className={i === passo ? estilos.passoAtual : i < passo ? estilos.passoFeito : undefined} aria-current={i === passo ? 'step' : undefined}>
            <span className={estilos.numero} aria-hidden="true">{i < passo ? '✓' : i + 1}</span>
            {nome}
          </li>
        ))}
      </ol>

      {emAnalise && (
        <p className={conta.alertaPagamento} role="status"><strong>Seu cadastro está em análise</strong>{TEXTO_EM_ANALISE}</p>
      )}

      <div className={estilos.grade}>
        <section className={estilos.etapa} aria-labelledby="titulo-passo">
          <div className={conta.acoes}>
            {passo > 0 && <button type="button" className={conta.secundario} onClick={() => irPara(passo - 1)} disabled={enviando}>Voltar</button>}
            {botaoAvancar}
          </div>

          {falha && (
            <div className={conta.erro} role="alert">
              <p>{falha.mensagem}</p>
              {falha.tipo === 'incerto' ? (
                <Link href="/conta/pedidos">Ver meus pedidos</Link>
              ) : whatsapp && (
                <a href={whatsapp} target="_blank" rel="noopener noreferrer">Falar com a distribuidora</a>
              )}
            </div>
          )}

          {passo === 0 && (
            <>
              <h2 id="titulo-passo" ref={tituloPasso} tabIndex={-1}>Como você quer receber?</h2>
              <fieldset className={estilos.opcoesLado}>
                <legend className="so-leitor">Tipo de entrega</legend>
                <Opcao nome="tipo-entrega" marcada={tipoEntrega === 'entrega'} aoMarcar={() => setTipoEntrega('entrega')} titulo="Entrega" />
                <Opcao nome="tipo-entrega" marcada={tipoEntrega === 'retirada'} aoMarcar={() => setTipoEntrega('retirada')} titulo="Retirar na loja" />
              </fieldset>

              {tipoEntrega === 'retirada' ? (
                <p className={conta.info}>Seu pedido ficará disponível para retirada na distribuidora após o faturamento. Sem custo de entrega.</p>
              ) : enderecos.fase === 'erro' ? (
                <ErroCarga mensagem={enderecos.erro} aoTentar={enderecos.recarregar} />
              ) : !lista ? (
                <Carregando />
              ) : (
                <>
                  {lista.length === 0 && !cadastrando && <p className={conta.suave}>Nenhum endereço cadastrado. Cadastre o endereço de entrega do seu negócio.</p>}
                  {lista.length > 0 && (
                    <fieldset className={estilos.opcoes}>
                      <legend className={estilos.legenda}>Endereço de entrega</legend>
                      {lista.map((e) => (
                        <Opcao key={e.id} nome="endereco" marcada={enderecoId === e.id} aoMarcar={() => setEnderecoId(e.id)}
                          titulo={e.apelido ?? `${e.logradouro}, ${e.numero}`}
                          descricao={`${e.logradouro}, ${e.numero}${e.complemento ? ` — ${e.complemento}` : ''} · ${e.bairro} · ${e.cidade}/${e.uf} · CEP ${formatarCep(e.cep)}`} />
                      ))}
                    </fieldset>
                  )}
                  {cadastrando ? (
                    <FormularioEndereco
                      inicial={{ ...ENDERECO_VAZIO, padrao: lista.length === 0 }}
                      id={null}
                      aoSalvar={(salvo) => {
                        setCadastrando(false);
                        if (salvo) setEnderecoId(salvo.id);
                        enderecos.recarregar();
                      }}
                      aoCancelar={() => setCadastrando(false)}
                    />
                  ) : (
                    <div className={conta.acoes}>
                      <button type="button" className={conta.secundario} onClick={() => setCadastrando(true)}>Novo endereço</button>
                    </div>
                  )}
                </>
              )}

              <div className={conta.campo}>
                <label htmlFor="observacoes">Observações (opcional)</label>
                <textarea id="observacoes" className={estilos.texto} rows={3} maxLength={MAX_OBSERVACOES} value={observacoes}
                  placeholder="Ex.: entregar no período da manhã" onChange={(e) => setObservacoes(e.target.value)} />
              </div>
            </>
          )}

          {passo === 1 && (
            <>
              <h2 id="titulo-passo" ref={tituloPasso} tabIndex={-1}>Como pagar?</h2>
              {saldo > 0 && (
                <label className={`${conta.cartao} ${estilos.saldo}`}>
                  <input type="checkbox" checked={usarSaldo} onChange={(e) => setUsarSaldo(e.target.checked)} />
                  <span>
                    <strong>Usar meu saldo ({formatarPreco(saldo)} disponível)</strong>
                    {usarSaldo && <span className={conta.suave}>{formatarPreco(aplicado)} serão abatidos do saldo · restam {formatarPreco(restante)} para pagar</span>}
                  </span>
                </label>
              )}
              <fieldset className={estilos.opcoes}>
                <legend className="so-leitor">Forma de pagamento</legend>
                {formas.map((f) => (
                  <div key={f.codigo} className={estilos.comCondicoes}>
                    <Opcao nome="forma" marcada={forma === f.codigo} aoMarcar={() => setForma(f.codigo)} titulo={f.titulo} descricao={f.descricao} />
                    {f.codigo === 'boleto' && forma === 'boleto' && (
                      <fieldset className={estilos.condicoes}>
                        <legend className={estilos.legenda}>Prazo do boleto</legend>
                        {condicoesBoleto.map((c) => (
                          <label key={c} className={condicao === c ? estilos.chipAtivo : estilos.chip}>
                            <input type="radio" name="condicao" className="so-leitor" checked={condicao === c} onChange={() => setCondicao(c)} />
                            {c}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  </div>
                ))}
              </fieldset>
              {cartaoEmBreve && (
                <div className={`${conta.cartao} ${estilos.emBreve}`}>
                  <strong>Cartão de crédito · em breve</strong>
                  <span className={conta.suave}>Ainda não disponível no site. Para pagar no cartão, compre direto na distribuidora.</span>
                  {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer">Falar com a distribuidora</a>}
                </div>
              )}
              <p className={conta.info}>{formaAtual.aviso}</p>
            </>
          )}

          {passo === 2 && (
            <>
              <h2 id="titulo-passo" ref={tituloPasso} tabIndex={-1}>Revise seu pedido</h2>
              <dl className={`${conta.cartao} ${conta.dados}`}>
                <dt>Entrega</dt>
                <dd>
                  {tipoEntrega === 'retirada'
                    ? 'Retirar na distribuidora'
                    : endereco ? `${endereco.logradouro}, ${endereco.numero}${endereco.complemento ? ` — ${endereco.complemento}` : ''} · ${endereco.cidade}/${endereco.uf}` : '—'}
                </dd>
                <dt>Pagamento</dt>
                <dd>{forma === 'boleto' ? `Boleto — ${condicao}` : formaAtual.titulo}</dd>
                {observacoes.trim() && <><dt>Observações</dt><dd style={{ whiteSpace: 'pre-line' }}>{observacoes.trim()}</dd></>}
              </dl>
              <ul className={`${conta.cartao} ${estilos.itens}`} aria-label="Itens do pedido">
                {carrinho.itens.map((i) => (
                  <li key={i.produtoId}>
                    <span className={estilos.qtd}>{i.quantidade}x</span>
                    <span className={estilos.nome}>{i.nome}</span>
                    <strong>{i.precoAtual != null ? formatarPreco(i.precoAtual * i.quantidade) : 'Sob consulta'}</strong>
                  </li>
                ))}
              </ul>
              <p className={conta.dica}>
                Os valores são os do seu carrinho agora. Se algo mudar ao fechar o pedido (preço ou estoque), vale o que a distribuidora
                registrar, e a página do pedido mostra o valor final.
              </p>
            </>
          )}
        </section>

        <aside className={estilos.resumo} aria-label="Resumo do pedido">
          <h2>Resumo</h2>
          <dl className={estilos.contas}>
            <div><dt>{carrinho.itens.length === 1 ? '1 produto' : `${carrinho.itens.length} produtos`}</dt><dd>{formatarPreco(subtotal)}</dd></div>
            {aplicado > 0 && <div className={estilos.desconto}><dt>Saldo usado</dt><dd>− {formatarPreco(aplicado)}</dd></div>}
            <div className={estilos.total}><dt>Total</dt><dd>{formatarPreco(restante)}</dd></div>
          </dl>
          {barra.temMinimo && !barra.atingiu && (
            <p className={estilos.minimo}>Faltam {formatarPreco(barra.falta)} para o mínimo de {formatarPreco(barra.minimo)}.</p>
          )}
          <Link href="/carrinho" className={estilos.editar}>Alterar carrinho</Link>
        </aside>
      </div>
    </>
  );
}

function Opcao({ nome, marcada, aoMarcar, titulo, descricao }: {
  nome: string; marcada: boolean; aoMarcar: () => void; titulo: string; descricao?: string;
}) {
  return (
    <label className={marcada ? estilos.opcaoAtiva : estilos.opcao}>
      <input type="radio" name={nome} checked={marcada} onChange={aoMarcar} />
      <span>
        <strong>{titulo}</strong>
        {descricao && <span className={estilos.descricao}>{descricao}</span>}
      </span>
    </label>
  );
}
