import type { Metadata } from 'next';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';

export const metadata: Metadata = { title: 'Busca', robots: { index: false, follow: true } };

export default async function PaginaBusca({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const filtros = lerFiltros(sp);
  const config = await buscarConfig();
  const pagina = q.length >= 2
    ? await buscarProdutos({ busca: q, pagina: filtros.pagina, ordem: filtros.ordem })
    : { dados: [], pagina: 1, temMais: false };

  return (
    <ListaProdutos titulo={q ? `Resultados para "${q}"` : 'Busca'} base="/busca" fixos={q ? { q } : {}}
      filtros={filtros} pagina={pagina} marcas={[]} subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio={q.length >= 2 ? 'Nenhum produto encontrado. Tente outra palavra.' : 'Digite pelo menos 2 letras para buscar.'} />
  );
}
