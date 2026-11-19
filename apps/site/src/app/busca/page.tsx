import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarTodosProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';
import { buscaLiberada } from '@/lib/catalogo/limite-busca';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const metadata: Metadata = { title: 'Busca', robots: { index: false, follow: true } };

const SEM_RESULTADO = { dados: [], pagina: 1, temMais: false };

export default async function PaginaBusca({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  // lista inteira, sem páginas (Tiago, 19/11/2026): link antigo com ?pagina=N cai na mesma lista
  const filtros = { ...lerFiltros(sp), pagina: 1 };
  const config = await buscarConfig();
  // Só conta (e só pode ser recusada) a busca que iria ao banco.
  const liberada = q.length < 2 || buscaLiberada(ipDoVisitante(await headers()), Date.now());
  const pagina = q.length >= 2 && liberada
    ? await buscarTodosProdutos({ busca: q, ordem: filtros.ordem })
    : SEM_RESULTADO;
  const vazio = !liberada
    ? 'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.'
    : q.length >= 2 ? 'Nenhum produto encontrado. Tente outra palavra.' : 'Digite pelo menos 2 letras para buscar.';

  return (
    <ListaProdutos titulo={q ? `Resultados para "${q}"` : 'Busca'} base="/busca" fixos={q ? { q } : {}}
      filtros={filtros} pagina={pagina} marcas={[]} subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio={vazio} />
  );
}
