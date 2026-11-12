'use client';

import Link from 'next/link';
import { rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import { useCarrinho } from './CarrinhoProvider';
import { useSessao } from './SessaoProvider';
import estilos from '@/app/carrinho/carrinho.module.css';

export function ItensCarrinho({ appNome }: { appNome: string }) {
  const { carrinho, carregado, erro, recarregar } = useCarrinho();
  const sessao = useSessao();
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
      <aside className={estilos.resumo}>
        <div className={estilos.total}><span>Subtotal</span><strong>{formatarPreco(carrinho.subtotal)}</strong></div>
        {sessao.carregado && (sessao.logado ? (
          <p>Fechamento do pedido pelo site em breve. Por enquanto finalize pelo app {appNome}: seu carrinho já está lá.</p>
        ) : (
          <Link href="/entrar?voltar=/carrinho" className={estilos.botaoDestaque}>Entrar para finalizar</Link>
        ))}
      </aside>
    </div>
  );
}
