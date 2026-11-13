'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useCarrinho } from '@/componentes/CarrinhoProvider';
import { aguardaPagamento, rotuloFormaPagamento, statusPagamentoOnline, statusPedido } from '@/lib/conta/status';
import type { NotaPedido, PedidoDetalhe } from '@/lib/conta/tipos';
import { formatarCep } from '@/lib/formato/documentos';
import { formatarData, formatarDataHora } from '@/lib/formato/datas';
import { formatarPreco } from '@/lib/formato/preco';
import { useDadosConta, useEnviarConta } from './api-conta';
import { Aviso, Carregando, ErroCarga, Etiqueta } from './Partes';
import estilos from './Conta.module.css';

const quantidade = (q: number) => (Number.isInteger(q) ? String(q) : q.toLocaleString('pt-BR'));

/** Links de DANFE e XML pelo próprio site (a URL assinada da API nunca chega ao navegador). */
export function ArquivosNota({ pedidoId, nota }: { pedidoId: string; nota: Pick<NotaPedido, 'temDanfe' | 'temXml' | 'numero'> }) {
  if (!nota.temDanfe && !nota.temXml) return <span className={estilos.suave}>Arquivos indisponíveis</span>;
  return (
    <span className={estilos.arquivos}>
      {nota.temDanfe && (
        <a href={`/api/conta/notas/${pedidoId}/danfe.pdf`} target="_blank" rel="noopener" className={`${estilos.secundario} ${estilos.pequeno}`}
          aria-label={`DANFE (PDF) da NF-e ${nota.numero}`}>
          DANFE (PDF)
        </a>
      )}
      {nota.temXml && (
        <a href={`/api/conta/notas/${pedidoId}/nota.xml`} download className={`${estilos.secundario} ${estilos.pequeno}`}
          aria-label={`XML da NF-e ${nota.numero}`}>
          XML
        </a>
      )}
    </span>
  );
}

export function DetalhePedido({ id, appNome }: { id: string; appNome: string }) {
  const carga = useDadosConta<PedidoDetalhe>(`/api/conta/pedidos/${id}`);
  const enviar = useEnviarConta();
  const { recarregar: recarregarCarrinho } = useCarrinho();
  const router = useRouter();
  const novo = useSearchParams().get('novo') === '1';
  const [repetindo, setRepetindo] = useState(false);
  const [erroRepetir, setErroRepetir] = useState<string | null>(null);

  const voltar = <Link href="/conta/pedidos" className={estilos.voltar}>← Meus pedidos</Link>;
  if (carga.fase === 'carregando' && !carga.dados) return <>{voltar}<h1>Pedido</h1><Carregando /></>;
  if (carga.status === 404) {
    return <>{voltar}<h1>Pedido não encontrado</h1><p className={estilos.suave}>Confira o link ou volte para a lista de pedidos.</p></>;
  }
  if (carga.fase === 'erro' || !carga.dados) return <>{voltar}<h1>Pedido</h1><ErroCarga mensagem={carga.erro} aoTentar={carga.recarregar} /></>;

  const p = carga.dados;

  const repetir = async () => {
    setRepetindo(true);
    setErroRepetir(null);
    const r = await enviar(`/api/conta/pedidos/${p.id}/repetir`, 'POST');
    if (r.ok) {
      recarregarCarrinho();
      router.push('/carrinho');
      return;
    }
    setRepetindo(false);
    setErroRepetir(r.mensagem);
  };

  return (
    <>
      {voltar}
      <h1>Pedido nº {p.numero}</h1>
      {/* ?novo=1 vem do /finalizar: só um recado, nada de pagamento depende dele. */}
      {novo && <Aviso tipo="sucesso">Recebemos seu pedido.</Aviso>}

      <div className={estilos.acoes}>
        <button type="button" className={estilos.primario} onClick={repetir} disabled={repetindo}>
          {repetindo ? 'Colocando no carrinho…' : 'Repetir pedido'}
        </button>
        <span className={estilos.dica}>
          Coloca os produtos deste pedido no carrinho, com as mesmas quantidades. O que já está no carrinho continua;
          um produto que já estava lá fica com a quantidade deste pedido. Produtos fora de linha não entram.
        </span>
      </div>
      {erroRepetir && <Aviso tipo="erro">{erroRepetir}</Aviso>}

      {aguardaPagamento(p.status) && (
        <p className={estilos.alertaPagamento} role="status">
          <strong>Este pedido está aguardando pagamento.</strong>
          Pague pelo app {appNome}. O pagamento pelo site chega em breve.
        </p>
      )}

      <div className={estilos.grade}>
        <section className={estilos.cartao} aria-labelledby="pedido-status">
          <h2 id="pedido-status">Status</h2>
          <Etiqueta rotulo={statusPedido(p.status)} />
          <p className={estilos.suave}>Feito em {formatarDataHora(p.criadoEm)}</p>
        </section>

        <section className={estilos.cartao} aria-labelledby="pedido-pagamento">
          <h2 id="pedido-pagamento">Pagamento</h2>
          <p>
            <strong>{rotuloFormaPagamento(p.formaPagamento)}</strong>
            {p.condicaoPagamento && <> · {p.condicaoPagamento}</>}
          </p>
          {p.pagamento && (
            <p>Pagamento online: <Etiqueta rotulo={statusPagamentoOnline(p.pagamento.status)} /></p>
          )}
          {p.cobranca && (
            <>
              <p>
                {p.cobranca.tipo === 'pix' ? 'PIX' : 'Boleto'}
                {p.cobranca.valor != null && <> · {formatarPreco(p.cobranca.valor)}</>}
                {' · '}{p.cobranca.pagoEm ? 'Pago' : 'Em aberto'}
              </p>
              {!p.cobranca.pagoEm && p.cobranca.vencimento && <p className={estilos.suave}>Vencimento: {formatarData(p.cobranca.vencimento)}</p>}
              {!p.cobranca.pagoEm && p.cobranca.linhaDigitavel && (
                <p className={estilos.mono} aria-label="Linha digitável">{p.cobranca.linhaDigitavel}</p>
              )}
            </>
          )}
          {!p.cobranca && !p.pagamento && p.formaPagamento === 'cartao' && (
            <p className={estilos.suave}>Cartão na entrega · crédito ou débito na maquininha ao receber o pedido</p>
          )}
        </section>

        <section className={estilos.cartao} aria-labelledby="pedido-entrega">
          <h2 id="pedido-entrega">Entrega</h2>
          {p.endereco ? (
            <>
              <p><strong>{p.endereco.logradouro}, {p.endereco.numero}{p.endereco.complemento && ` — ${p.endereco.complemento}`}</strong></p>
              <p className={estilos.suave}>{p.endereco.bairro} · {p.endereco.cidade}/{p.endereco.uf} · CEP {formatarCep(p.endereco.cep)}</p>
            </>
          ) : (
            <p><strong>{p.tipoEntrega === 'retirada' ? 'Retirada na distribuidora' : '—'}</strong></p>
          )}
        </section>
      </div>

      <section className={estilos.cartao} aria-labelledby="pedido-itens">
        <h2 id="pedido-itens">Itens ({p.itens.length})</h2>
        <table className={estilos.tabela}>
          <thead>
            <tr><th><span className="so-leitor">Foto</span></th><th>Produto</th><th>Qtd.</th><th className={estilos.direita}>Preço</th><th className={estilos.direita}>Total</th></tr>
          </thead>
          <tbody>
            {p.itens.map((i, n) => (
              <tr key={`${i.produtoId ?? 'item'}-${n}`}>
                <td data-rotulo=""><div className={estilos.foto}>{i.imagemUrl && <img src={i.imagemUrl} alt="" loading="lazy" />}</div></td>
                <td data-rotulo="Produto">{i.descricao}</td>
                <td data-rotulo="Quantidade">{quantidade(i.quantidade)}</td>
                <td data-rotulo="Preço" className={estilos.direita}>{i.precoUnit != null ? formatarPreco(i.precoUnit) : '—'}</td>
                <td data-rotulo="Total" className={estilos.direita}><strong>{i.total != null ? formatarPreco(i.total) : '—'}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className={estilos.totais}>
          <div><dt>Subtotal</dt><dd>{formatarPreco(p.subtotal)}</dd></div>
          {p.desconto > 0 && <div><dt>Desconto</dt><dd>− {formatarPreco(p.desconto)}</dd></div>}
          {p.saldoUsado > 0 && <div><dt>Saldo da carteira usado</dt><dd>− {formatarPreco(p.saldoUsado)}</dd></div>}
          <div className={estilos.totalFinal}><dt>Total</dt><dd>{formatarPreco(p.total)}</dd></div>
        </dl>
      </section>

      {p.nota && (
        <section className={estilos.cartao} aria-labelledby="pedido-nota">
          <h2 id="pedido-nota">Nota fiscal</h2>
          <ArquivosNota pedidoId={p.id} nota={p.nota} />
          <p><strong>NF-e nº {p.nota.numero}</strong>{p.nota.emitidaEm && <> · emitida em {formatarData(p.nota.emitidaEm)}</>}</p>
          {p.nota.chaveAcesso && <p className={estilos.mono} aria-label="Chave de acesso">{p.nota.chaveAcesso}</p>}
        </section>
      )}

      {p.eventos.length > 0 && (
        <section className={estilos.cartao} aria-labelledby="pedido-acompanhamento">
          <h2 id="pedido-acompanhamento">Acompanhamento</h2>
          <ol className={estilos.linhaTempo}>
            {p.eventos.map((e, n) => (
              <li key={n}>
                <strong>{statusPedido(e.status).rotulo}</strong>
                {e.detalhe && <span className={estilos.suave}>{e.detalhe}</span>}
                <span className={estilos.dica}>{formatarDataHora(e.em)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {p.observacoes && (
        <section className={estilos.cartao} aria-labelledby="pedido-obs">
          <h2 id="pedido-obs">Observações</h2>
          <p style={{ whiteSpace: 'pre-line' }}>{p.observacoes}</p>
        </section>
      )}
    </>
  );
}
