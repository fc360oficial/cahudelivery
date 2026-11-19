import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarTodosProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';
import { buscaLiberada } from '@/lib/catalogo/limite-busca';
import { casa, chaveDeBusca, tokensDe } from '@/lib/catalogo/sugestoes';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const metadata: Metadata = { title: 'Busca', robots: { index: false, follow: true } };

const SEM_RESULTADO = { dados: [], pagina: 1, temMais: false };

export default async function PaginaBusca({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  // lista inteira, sem páginas (Tiago, 19/11/2026): link antigo com ?pagina=N cai na mesma lista
  const filtros = { ...lerFiltros(sp), pagina: 1 };
  const config = await buscarConfig();
  // Mesma regra das sugestões do cabeçalho (lib/catalogo/sugestoes): todas as palavras, em qualquer ordem, sem acento e
  // pela metade, procurando no nome, na marca e nos códigos. Assim a lista completa nunca discorda do que a sugestão mostrou.
  const tokens = tokensDe(q);
  const liberada = tokens.length === 0 || buscaLiberada(ipDoVisitante(await headers()), Date.now());
  const pagina = tokens.length > 0 && liberada
    ? { dados: (await buscarTodosProdutos({ ordem: filtros.ordem })).dados.filter((p) => casa(chaveDeBusca(p), tokens)), pagina: 1, temMais: false }
    : SEM_RESULTADO;
  const vazio = !liberada
    ? 'Muitas buscas em pouco tempo. Aguarde um minuto e tente de novo.'
    : tokens.length > 0 ? 'Nenhum produto encontrado. Tente outra palavra.' : 'Digite pelo menos 2 letras para buscar.';

  return (
    <ListaProdutos titulo={q ? `Resultados para "${q}"` : 'Busca'} base="/busca" fixos={q ? { q } : {}}
      filtros={filtros} pagina={pagina} marcas={[]} subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio={vazio} />
  );
}
