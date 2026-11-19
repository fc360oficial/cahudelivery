import type { Home, Patrocinador, Produto } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';

export type SecaoHome =
  | { tipo: 'produtos'; chave: string; titulo: string; produtos: Produto[]; verTodos: string | null }
  | { tipo: 'patrocinador'; chave: string; patrocinador: Patrocinador };

/** A chave leva o espaço (topo, ofertas, prat): o mesmo patrocinador pode aparecer em mais de um. */
const patrocinada = (espaco: string) => (p: Patrocinador): SecaoHome => ({ tipo: 'patrocinador', chave: `pat-${espaco}-${p.id}`, patrocinador: p });

/** "Mais pedidos" só aparece quando enche uma linha inteira (7 cartões na largura cheia): com poucos itens
 *  (pedidos de teste, loja começando) a prateleira parece quebrada. Ela volta sozinha quando houver vendas.
 *  Decisão do Tiago em 19/11/2026. Só no site. */
export const MINIMO_MAIS_PEDIDOS = 7;

/** Mesma ordem da Home do app (home_screen.dart): patrocinador do topo, Ofertas, patrocinador
 *  das ofertas, Mais vendidos, Vencimento Próximo e depois as prateleiras. Seção vazia some. */
export function montarSecoesHome(home: Home): SecaoHome[] {
  const secoes: SecaoHome[] = [
    ...home.patrocinadoresTopo.map(patrocinada('topo')),
    { tipo: 'produtos', chave: 'ofertas', titulo: 'Ofertas da semana', produtos: home.promocoes, verTodos: '/ofertas' },
    ...home.patrocinadoresOfertas.map(patrocinada('ofertas')),
    { tipo: 'produtos', chave: 'mais-vendidos', titulo: 'Mais pedidos', produtos: home.maisVendidos, verTodos: null },
    { tipo: 'produtos', chave: 'vencimento', titulo: 'Vencimento próximo', produtos: home.vencimentoProximo, verTodos: null },
    ...home.prateleiras.map((p): SecaoHome =>
      p.tipo === 'patrocinador'
        ? patrocinada('prat')(p)
        : { tipo: 'produtos', chave: `cat-${p.categoriaId}`, titulo: p.nome, produtos: p.produtos, verTodos: caminhoCategoria({ id: p.categoriaId, nome: p.nome }) }),
  ];
  return secoes.filter((s) => {
    if (s.tipo === 'patrocinador') return s.patrocinador.produtos.length > 0;
    return s.produtos.length >= (s.chave === 'mais-vendidos' ? MINIMO_MAIS_PEDIDOS : 1);
  });
}
