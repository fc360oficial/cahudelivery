import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarCategorias, buscarConfig, buscarMarcas, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';
import { caminhoCategoria, idDoSegmento } from '@/lib/formato/caminhos';

interface Props { params: Promise<{ slug: string }>; searchParams: Promise<ParametrosUrl> }

async function categoriaDe(slug: string) {
  const id = idDoSegmento(slug);
  if (!id) return null;
  const categorias = await buscarCategorias();
  const categoria = categorias.find((c) => c.id === id);
  return categoria ? { categoria, categorias } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const achada = await categoriaDe((await params).slug);
  return achada ? { title: achada.categoria.nome, alternates: { canonical: caminhoCategoria(achada.categoria) } } : {};
}

export default async function PaginaCategoria({ params, searchParams }: Props) {
  const { slug } = await params;
  const achada = await categoriaDe(slug);
  if (!achada) notFound();
  const { categoria, categorias } = achada;

  const canonico = caminhoCategoria(categoria);
  if (`/c/${slug}` !== canonico) permanentRedirect(canonico);

  const filtros = lerFiltros(await searchParams);
  const subcategorias = categorias.filter((c) => c.paiId === categoria.id);
  // Subcategoria só vale se for mesmo filha desta categoria.
  const alvo = filtros.sub && subcategorias.some((s) => s.id === filtros.sub) ? filtros.sub : categoria.id;

  const [pagina, marcas, config] = await Promise.all([
    buscarProdutos({ categoria: alvo, marca: filtros.marca ?? undefined, pagina: filtros.pagina, ordem: filtros.ordem }),
    buscarMarcas(categoria.id),
    buscarConfig(),
  ]);

  return (
    <ListaProdutos titulo={categoria.nome} base={canonico} filtros={filtros} pagina={pagina} marcas={marcas}
      subcategorias={subcategorias} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio="Nenhum produto disponível nesta categoria com esses filtros." />
  );
}
