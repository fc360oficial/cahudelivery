'use client';

import Link from 'next/link';
import { barraDoMinimo, podeFinalizar } from '@/lib/checkout/minimo';
import { rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco } from '@/lib/formato/preco';
import { avisoCheckoutDesligado } from '@/lib/site';
import { BotaoAdicionar } from './BotaoAdicionar';
import { useCarrinho } from './CarrinhoProvider';
import { useSessao } from './SessaoProvider';
import estilos from '@/app/carrinho/carrinho.module.css';

interface Props {
  pedidoMinimo: number | null;
  /** CHECKOUT_LIGADO lido no servidor; desligado = aviso do app no lugar de "Finalizar pedido". */
  checkoutLigado: boolean;
  appNome: string;
}

export function ItensCarrinho({ pedidoMinimo, checkoutLigado, appNome }: Props) {
  const { carrinho, carregado, erro, recarregar } = useCarrinho();
  if (!carregado) {
    return (
      <div className={estilos.vazio}>
        {erro ? (
          <>
            <p>{erro}</p>
            <button type="button" className={estilos.botao} onClick={recarregar}>Tentar de novo</button>
          </>
        ) : (
          <p>Carregando seu carrinho…</p>
        )}
      </div>
    );
  }
  if (carrinho.itens.length === 0) {
    return (
      <div className={estilos.vazio}>
        <p>Seu carrinho está vazio.</p>
        <Link href="/" className={estilos.botao}>Ver produtos</Link>
      </div>
    );
  }
  return (
    <div className={estilos.grade}>
      <ul className={estilos.lista}>
        {carrinho.itens.map((i) => (
          <li key={i.produtoId} className={estilos.item}>
            <div className={estilos.foto}>{i.imagemUrl && <img src={i.imagemUrl} alt="" loading="lazy" />}</div>
            <div className={estilos.info}>
              <strong>{i.nome}</strong>
              <span>{rotuloEmbalagem(i.unidadeVenda, 1)}{i.precoAtual != null && ` · ${formatarPreco(i.precoAtual)} cada`}</span>
            </div>
            <BotaoAdicionar produtoId={i.produtoId} qtdMinima={i.qtdMinima} nome={i.nome} />
            <strong className={estilos.subtotalItem}>
              {i.precoAtual != null ? formatarPreco(i.precoAtual * i.quantidade) : 'Sob consulta'}
            </strong>
          </li>
        ))}
      </ul>
      <ResumoCarrinho subtotal={carrinho.subtotal} itens={carrinho.itens.length} pedidoMinimo={pedidoMinimo} checkoutLigado={checkoutLigado} appNome={appNome} />
    </div>
  );
}

/** Texto do app (carrinho_screen.dart) para quem ainda está em análise. */
export const TEXTO_EM_ANALISE =
  'Seu cadastro ainda está sendo analisado pela distribuidora. Entre em contato para agilizar a aprovação antes de fechar pedidos.';

function ResumoCarrinho({ subtotal, itens, pedidoMinimo, checkoutLigado, appNome }: { subtotal: number; itens: number } & Props) {
  const sessao = useSessao();
  const barra = barraDoMinimo(subtotal, pedidoMinimo);
  const decisao = podeFinalizar({ itens, atingiu: barra.atingiu, statusCadastro: sessao.status });
  return (
    <aside className={estilos.resumo} aria-label="Resumo do pedido">
      {barra.temMinimo && (
        <div className={estilos.minimo}>
          <p className={barra.atingiu ? estilos.minimoOk : estilos.minimoFalta} role="status">
            {barra.atingiu
              ? 'Pedido mínimo atingido!'
              : `Faltam ${formatarPreco(barra.falta)} para o mínimo de ${formatarPreco(barra.minimo)}`}
          </p>
          <div className={estilos.trilho} aria-hidden="true">
            <div className={barra.atingiu ? estilos.preenchidoOk : estilos.preenchido} style={{ width: `${Math.round(barra.progresso * 100)}%` }} />
          </div>
        </div>
      )}
      <dl className={estilos.contas}>
        <div><dt>Subtotal</dt><dd>{formatarPreco(subtotal)}</dd></div>
        <div className={estilos.total}><dt>Total</dt><dd><strong>{formatarPreco(subtotal)}</strong></dd></div>
      </dl>
      {sessao.carregado && (sessao.logado ? !checkoutLigado ? (
        <p>{avisoCheckoutDesligado(appNome)}</p>
      ) : (
        <>
          {decisao.motivo === 'em-analise' && (
            <p className={estilos.emAnalise} role="status"><strong>Seu cadastro está em análise</strong>{TEXTO_EM_ANALISE}</p>
          )}
          {decisao.pode ? (
            <Link href="/finalizar" className={estilos.botaoDestaque}>Finalizar pedido</Link>
          ) : (
            <button type="button" className={estilos.botaoDestaque} disabled>Finalizar pedido</button>
          )}
        </>
      ) : (
        <Link href="/entrar?voltar=/carrinho" className={estilos.botaoDestaque}>Entrar para finalizar</Link>
      ))}
    </aside>
  );
}
