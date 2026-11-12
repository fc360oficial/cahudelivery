import type { Metadata } from 'next';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';

export const metadata: Metadata = { title: 'Ofertas da semana' };

export default async function PaginaOfertas({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const filtros = lerFiltros(await searchParams);
  const [pagina, config] = await Promise.all([
    buscarProdutos({ promocao: true, pagina: filtros.pagina, ordem: filtros.ordem }),
    buscarConfig(),
  ]);
  return (
    <ListaProdutos titulo="Ofertas da semana" base="/ofertas" filtros={filtros} pagina={pagina} marcas={[]}
      subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo} vazio="Nenhuma oferta no momento." />
  );
}
