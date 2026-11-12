import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { CompraProduto } from '@/componentes/CompraProduto';
import { Galeria } from '@/componentes/Galeria';
import { Vitrine } from '@/componentes/Vitrine';
import { buscarConfig, buscarProduto, buscarRelacionados } from '@/lib/api/catalogo';
import { ErroApi } from '@/lib/api/cliente';
import type { Produto } from '@/lib/api/tipos';
import { selosDoProduto } from '@/lib/catalogo/selos';
import { caminhoCategoria, caminhoProduto, idDoSegmento } from '@/lib/formato/caminhos';
import { nomeEmbalagem, rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import estilos from './produto.module.css';

export const revalidate = 60;
/** Nenhuma página gerada no build; cada produto é montado no primeiro acesso e fica em cache. */
export async function generateStaticParams() { return []; }

interface Props { params: Promise<{ slug: string }> }

async function produtoDe(slug: string): Promise<Produto | null> {
  const id = idDoSegmento(slug);
  if (!id) return null;
  try {
    return await buscarProduto(id);
  } catch (e) {
    if (e instanceof ErroApi && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const produto = await produtoDe((await params).slug);
  if (!produto) return {};
  return {
    title: produto.nome,
    description: `${produto.nome}, ${rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem).toLowerCase()}.`,
    alternates: { canonical: caminhoProduto(produto) },
  };
}

export default async function PaginaProduto({ params }: Props) {
  const { slug } = await params;
  const produto = await produtoDe(slug);
  if (!produto) notFound();

  const canonico = caminhoProduto(produto);
  if (`/p/${slug}` !== canonico) permanentRedirect(canonico);

  const [relacionados, config] = await Promise.all([buscarRelacionados(produto.id), buscarConfig()]);
  const unidade = produto.preco != null ? precoPorUnidade(produto.preco, produto.qtdPorEmbalagem) : null;
  const selos = selosDoProduto(produto, config.limiteEstoqueBaixo);
  const disponivel = produto.preco != null && produto.estoque > 0;
  const emOferta = produto.precoPromocional != null && produto.precoTabela != null && produto.precoTabela > (produto.preco ?? 0);

  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <nav aria-label="Você está em" className={estilos.trilha}>
        <Link href="/">Início</Link>
        {produto.categoria && produto.categoriaId && (
          <><span aria-hidden="true">/</span><Link href={caminhoCategoria({ id: produto.categoriaId, nome: produto.categoria })}>{produto.categoria}</Link></>
        )}
        <span aria-hidden="true">/</span><span>{produto.nome}</span>
      </nav>

      <div className={estilos.principal}>
        <div className={estilos.colunaFoto}><Galeria imagens={produto.imagens} nome={produto.nome} /></div>

        <div className={estilos.colunaInfo}>
          <div className={estilos.cabeca}>
            {produto.marca && <span className={estilos.sobre}>{produto.marca}</span>}
            <h1>{produto.nome}</h1>
            <div className={estilos.meta}>
              {produto.sku && <span>Cód. {produto.sku}</span>}
              <span className={disponivel ? estilos.emEstoque : estilos.semEstoque}>
                {disponivel ? 'Em estoque' : 'Indisponível no momento'}
              </span>
            </div>
            {selos.length > 0 && (
              <div className={estilos.selos}>
                {selos.map((s) => <span key={s.tipo} className={`${estilos.selo} ${estilos[s.tipo]}`}>{s.texto}</span>)}
              </div>
            )}
          </div>

          {produto.preco != null ? (
            <div className={estilos.precos}>
              <div className={estilos.precoPrincipal}>
                <span>{rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem)}</span>
                {emOferta && <s>{formatarPreco(produto.precoTabela as number)}</s>}
                <strong>{formatarPreco(produto.preco)}</strong>
              </div>
              {unidade != null && (
                <div className={estilos.precoSecundario}>
                  <span>Sai por unidade</span>
                  <strong>{formatarPreco(unidade)}</strong>
                </div>
              )}
            </div>
          ) : (
            <p className={estilos.nota}>Preço sob consulta. Fale com a distribuidora.</p>
          )}

          {disponivel && (
            <CompraProduto produtoId={produto.id} qtdMinima={produto.qtdMinima} qtdPorEmbalagem={produto.qtdPorEmbalagem}
              preco={produto.preco} precoTabela={produto.precoTabela}
              descontoQtdMinima={produto.descontoQtdMinima} descontoQtdPreco={produto.descontoQtdPreco} />
          )}

          <dl className={estilos.ficha}>
            <div><dt>Vendido por</dt><dd>{nomeEmbalagem(produto.unidadeVenda)}</dd></div>
            {produto.ean && <div><dt>Código de barras</dt><dd>{produto.ean}</dd></div>}
            {produto.categoria && <div><dt>Categoria</dt><dd>{produto.categoria}</dd></div>}
          </dl>
          {produto.descricao && <p className={estilos.descricao}>{produto.descricao}</p>}
        </div>
      </div>

      {relacionados.pecaTambem.length > 0 && (
        <Vitrine titulo="Quem leva este produto também pede" produtos={relacionados.pecaTambem} verTodos={null} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
      )}
      {relacionados.similares.length > 0 && (
        <Vitrine titulo="Produtos parecidos" produtos={relacionados.similares} verTodos={null} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
      )}
    </div>
  );
}
