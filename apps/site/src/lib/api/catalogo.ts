import { chamarApi, ErroApi } from './cliente';
import { normalizarCategoria, normalizarConfig, normalizarHome, normalizarProduto } from './normalizar';
import type { Categoria, ConfigLoja, Home, Marca, PaginaProdutos, Produto, Relacionados } from './tipos';

/** Cache do catálogo: o preço que o Dlinks atualiza aparece em até 1 minuto. */
const REVALIDAR = 60;

type Bruto = Record<string, unknown>;

export async function buscarConfig(): Promise<ConfigLoja> {
  return normalizarConfig(await chamarApi<Bruto>('/config', { revalidar: REVALIDAR }));
}

export async function buscarHome(): Promise<Home> {
  return normalizarHome(await chamarApi<Bruto>('/home', { revalidar: REVALIDAR }));
}

export async function buscarCategorias(): Promise<Categoria[]> {
  return (await chamarApi<Bruto[]>('/categorias', { revalidar: REVALIDAR })).map(normalizarCategoria);
}

export async function buscarMarcas(categoriaId?: string): Promise<Marca[]> {
  const q = categoriaId ? `?categoria=${categoriaId}` : '';
  // Uma API ainda sem a rota de marcas (publicada antes do site) não derruba a listagem: só some o filtro.
  const linhas = await chamarApi<Bruto[]>(`/marcas${q}`, { revalidar: REVALIDAR }).catch((e: unknown) => {
    if (e instanceof ErroApi && e.status === 404) return [] as Bruto[];
    throw e;
  });
  return linhas.map((m) => ({ id: String(m.id), nome: String(m.nome ?? ''), produtos: Number(m.produtos) || 0 }));
}

export interface FiltroBusca {
  categoria?: string;
  marca?: string;
  busca?: string;
  promocao?: boolean;
  ordem: string;
}

/** A API entrega no máximo 50 produtos por chamada. */
const LOTE_DA_API = 50;
/** Teto de segurança da lista inteira (20 chamadas): acima disso a categoria precisaria voltar a ter páginas. */
const MAXIMO_NA_LISTA = 1000;

/**
 * Lista INTEIRA de uma categoria, busca ou das ofertas, sem páginas (Tiago, 19/11/2026: "aqui tem que vir todos").
 * Junta os lotes de 50 da API até acabar; as fotos dos cartões só carregam quando chegam perto da tela.
 */
export async function buscarTodosProdutos(f: FiltroBusca): Promise<PaginaProdutos> {
  const dados: Produto[] = []; const vistos = new Set<string>();
  for (let pagina = 1; dados.length < MAXIMO_NA_LISTA; pagina++) {
    const q = new URLSearchParams({ pagina: String(pagina), limite: String(LOTE_DA_API), ordem: f.ordem });
    if (f.categoria) q.set('categoria', f.categoria);
    if (f.marca) q.set('marca', f.marca);
    if (f.busca) q.set('busca', f.busca);
    if (f.promocao) q.set('promocao', 'true');
    // Busca livre sem cache: cada termo × lote × ordem criaria uma entrada que nunca sai do disco.
    const r = await chamarApi<{ dados?: Bruto[]; temMais?: boolean }>(`/produtos?${q}`, f.busca ? {} : { revalidar: REVALIDAR });
    const lote = (r.dados ?? []).map(normalizarProduto);
    // produto que mudou de posição entre uma chamada e outra (preço ou nome alterado no meio) não aparece duas vezes
    for (const p of lote) if (!vistos.has(p.id)) { vistos.add(p.id); dados.push(p); }
    if (r.temMais !== true || lote.length === 0) break;
  }
  return { dados: dados.slice(0, MAXIMO_NA_LISTA), pagina: 1, temMais: false };
}

export async function buscarProduto(id: string): Promise<Produto> {
  return normalizarProduto(await chamarApi<Bruto>(`/produtos/${id}`, { revalidar: REVALIDAR }));
}

export async function buscarRelacionados(id: string): Promise<Relacionados> {
  const r = await chamarApi<{ similares: Bruto[]; pecaTambem: Bruto[] }>(`/produtos/${id}/relacionados`, { revalidar: REVALIDAR });
  return { similares: (r.similares ?? []).map(normalizarProduto), pecaTambem: (r.pecaTambem ?? []).map(normalizarProduto) };
}
