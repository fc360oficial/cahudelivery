import Link from 'next/link';
import type { Produto } from '@/lib/api/tipos';
import { emOferta as emOfertaProduto } from '@/lib/catalogo/oferta';
import { selosDoProduto } from '@/lib/catalogo/selos';
import { caminhoProduto } from '@/lib/formato/caminhos';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import estilos from './CartaoProduto.module.css';

/** Etiqueta curta da embalagem sobre a foto: "CX 30un", "FD 12un" ou só "UN". */
function etiquetaEmbalagem(unidade: string, qtd: number): string {
  const sigla = String(unidade ?? '').toUpperCase() || 'UN';
  return qtd > 1 ? `${sigla} ${qtd}un` : sigla;
}

export function CartaoProduto({ produto, limiteEstoqueBaixo }: { produto: Produto; limiteEstoqueBaixo: number }) {
  const href = caminhoProduto(produto);
  const foto = produto.imagens[0];
  const unidade = produto.preco != null ? precoPorUnidade(produto.preco, produto.qtdPorEmbalagem) : null;
  const selos = selosDoProduto(produto, limiteEstoqueBaixo);
  const oferta = selos.find((s) => s.tipo === 'oferta');
  const avisos = selos.filter((s) => s.tipo !== 'oferta');
  const emOferta = emOfertaProduto(produto);
  const comprar = produto.preco != null && produto.estoque > 0;

  return (
    <article className={estilos.cartao} data-testid="cartao-produto">
      <div className={estilos.quadro}>
        <Link href={href} className={estilos.foto} aria-label={produto.nome}>
          {foto
            ? <img src={foto.miniatura ?? foto.url} alt="" loading="lazy" decoding="async" />
            : <span className={estilos.semFoto}>Sem foto</span>}
        </Link>
        {avisos.length > 0 && (
          <span className={estilos.avisos}>
            {avisos.map((s) => <span key={s.tipo} className={`${estilos.aviso} ${estilos[s.tipo]}`}>{s.texto}</span>)}
          </span>
        )}
        <span className={estilos.embalagem}>{etiquetaEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem)}</span>
        {comprar && (
          <span className={estilos.acao}>
            <BotaoAdicionar produtoId={produto.id} qtdMinima={produto.qtdMinima} nome={produto.nome} />
          </span>
        )}
      </div>
      <div className={estilos.corpo}>
        {produto.preco != null ? (
          <>
            <strong className={estilos.preco}>{formatarPreco(produto.preco)}</strong>
            {(oferta || emOferta) && (
              <span className={estilos.linhaOferta}>
                {oferta && <span className={estilos.desconto}>{oferta.texto.replace('-', '')}{oferta.texto.includes('%') ? ' OFF' : ''}</span>}
                {emOferta && <s>{formatarPreco(produto.precoTabela as number)}</s>}
              </span>
            )}
            {unidade != null && <span className={estilos.suave}>{formatarPreco(unidade)} a unidade</span>}
          </>
        ) : (
          <span className={estilos.suave}>Preço sob consulta</span>
        )}
        <Link href={href} className={estilos.nome}>{produto.nome}</Link>
      </div>
    </article>
  );
}
