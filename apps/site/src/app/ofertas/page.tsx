import type { Metadata } from 'next';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarTodosProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';

export const metadata: Metadata = { title: 'Ofertas da semana' };

export default async function PaginaOfertas({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  // lista inteira, sem páginas (Tiago, 19/11/2026): link antigo com ?pagina=N cai na mesma lista
  const filtros = { ...lerFiltros(await searchParams), pagina: 1 };
  const [pagina, config] = await Promise.all([
    buscarTodosProdutos({ promocao: true, ordem: filtros.ordem }),
    buscarConfig(),
  ]);
  return (
    <ListaProdutos titulo="Ofertas da semana" base="/ofertas" filtros={filtros} pagina={pagina} marcas={[]}
      subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo} vazio="Nenhuma oferta no momento." />
  );
}
