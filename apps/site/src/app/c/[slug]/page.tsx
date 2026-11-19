import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarCategorias, buscarConfig, buscarMarcas, buscarTodosProdutos } from '@/lib/api/catalogo';
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

  // lista inteira, sem páginas (Tiago, 19/11/2026): link antigo com ?pagina=N cai na mesma lista
  const filtros = { ...lerFiltros(await searchParams), pagina: 1 };
  const subcategorias = categorias.filter((c) => c.paiId === categoria.id);
  // Subcategoria só vale se for mesmo filha desta categoria.
  const alvo = filtros.sub && subcategorias.some((s) => s.id === filtros.sub) ? filtros.sub : categoria.id;

  const [pagina, marcas, config] = await Promise.all([
    buscarTodosProdutos({ categoria: alvo, marca: filtros.marca ?? undefined, ordem: filtros.ordem }),
    buscarMarcas(categoria.id),
    buscarConfig(),
  ]);

  return (
    <ListaProdutos titulo={categoria.nome} base={canonico} filtros={filtros} pagina={pagina} marcas={marcas}
      subcategorias={subcategorias} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio="Nenhum produto disponível nesta categoria com esses filtros." />
  );
}
