import Link from 'next/link';
import type { Produto } from '@/lib/api/tipos';
import { emOferta as emOfertaProduto } from '@/lib/catalogo/oferta';
import { selosDoProduto } from '@/lib/catalogo/selos';
import { caminhoProduto } from '@/lib/formato/caminhos';
import { rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import estilos from './CartaoProduto.module.css';

export function CartaoProduto({ produto, limiteEstoqueBaixo }: { produto: Produto; limiteEstoqueBaixo: number }) {
  const href = caminhoProduto(produto);
  const foto = produto.imagens[0];
  const unidade = produto.preco != null ? precoPorUnidade(produto.preco, produto.qtdPorEmbalagem) : null;
  const selos = selosDoProduto(produto, limiteEstoqueBaixo);
  const emOferta = emOfertaProduto(produto);

  return (
    <article className={estilos.cartao} data-testid="cartao-produto">
      <Link href={href} className={estilos.foto} aria-label={produto.nome}>
        {foto
          ? <img src={foto.miniatura ?? foto.url} alt="" loading="lazy" decoding="async" />
          : <span className={estilos.semFoto}>Sem foto</span>}
        {selos.length > 0 && (
          <span className={estilos.selos}>
            {selos.map((s) => <span key={s.tipo} className={`${estilos.selo} ${estilos[s.tipo]}`}>{s.texto}</span>)}
          </span>
        )}
      </Link>
      <div className={estilos.texto}>
        {produto.categoria && <span className={estilos.suave}>{produto.categoria}</span>}
        <Link href={href} className={estilos.nome}>{produto.nome}</Link>
        <span className={estilos.suave}>{rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem)}</span>
      </div>
      <div className={estilos.rodape}>
        {produto.preco != null ? (
          <div>
            {emOferta && <s className={estilos.suave}>{formatarPreco(produto.precoTabela as number)}</s>}
            <strong className={estilos.preco}>{formatarPreco(produto.preco)}</strong>
            {unidade != null && <span className={estilos.suave}>{formatarPreco(unidade)} a unidade</span>}
          </div>
        ) : (
          <span className={estilos.suave}>Preço sob consulta</span>
        )}
        {produto.preco != null && produto.estoque > 0 && (
          <BotaoAdicionar produtoId={produto.id} qtdMinima={produto.qtdMinima} nome={produto.nome} />
        )}
      </div>
    </article>
  );
}
