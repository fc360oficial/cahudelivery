import { chamarApi } from './cliente';
import { normalizarCategoria, normalizarConfig, normalizarHome, normalizarProduto } from './normalizar';
import type { Categoria, ConfigLoja, Home, Marca, PaginaProdutos, Produto, Relacionados } from './tipos';

/** Cache do catálogo: o preço que o Dlinks atualiza aparece em até 1 minuto. */
const REVALIDAR = 60;
export const ITENS_POR_PAGINA = 24;

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
  const linhas = await chamarApi<Bruto[]>(`/marcas${q}`, { revalidar: REVALIDAR });
  return linhas.map((m) => ({ id: String(m.id), nome: String(m.nome ?? ''), produtos: Number(m.produtos) || 0 }));
}

export interface FiltroBusca {
  categoria?: string;
  marca?: string;
  busca?: string;
  promocao?: boolean;
  pagina: number;
  ordem: string;
}

export async function buscarProdutos(f: FiltroBusca): Promise<PaginaProdutos> {
  const q = new URLSearchParams({ pagina: String(f.pagina), limite: String(ITENS_POR_PAGINA), ordem: f.ordem });
  if (f.categoria) q.set('categoria', f.categoria);
  if (f.marca) q.set('marca', f.marca);
  if (f.busca) q.set('busca', f.busca);
  if (f.promocao) q.set('promocao', 'true');
  // Busca livre sem cache: cada termo × página × ordem criaria uma entrada que nunca sai do disco.
  const r = await chamarApi<{ dados?: Bruto[]; pagina: number; temMais?: boolean }>(`/produtos?${q}`, f.busca ? {} : { revalidar: REVALIDAR });
  return { dados: (r.dados ?? []).map(normalizarProduto), pagina: r.pagina, temMais: r.temMais === true };
}

export async function buscarProduto(id: string): Promise<Produto> {
  return normalizarProduto(await chamarApi<Bruto>(`/produtos/${id}`, { revalidar: REVALIDAR }));
}

export async function buscarRelacionados(id: string): Promise<Relacionados> {
  const r = await chamarApi<{ similares: Bruto[]; pecaTambem: Bruto[] }>(`/produtos/${id}/relacionados`, { revalidar: REVALIDAR });
  return { similares: (r.similares ?? []).map(normalizarProduto), pecaTambem: (r.pecaTambem ?? []).map(normalizarProduto) };
}
