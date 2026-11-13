import { chamarApi } from '@/lib/api/cliente';
import { buscarProduto } from '@/lib/api/catalogo';
import { normalizarPedidoDetalhe } from '@/lib/conta/normalizar-conta';
import { naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

/** Fotos buscadas no catálogo público (com cache), no máximo para esta quantidade de produtos. */
const MAX_FOTOS = 60;

/** O pedido não guarda imagem: a foto vem do catálogo público; produto fora de linha fica sem. */
async function fotos(ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((id) => UUID_INTEIRO.test(id)))].slice(0, MAX_FOTOS);
  const resultados = await Promise.allSettled(unicos.map((id) => buscarProduto(id)));
  const mapa = new Map<string, string>();
  resultados.forEach((r, i) => {
    const img = r.status === 'fulfilled' ? r.value.imagens[0] : undefined;
    if (img) mapa.set(unicos[i], img.miniatura ?? img.url);
  });
  return mapa;
}

/** GET pedidos/:id. Pedido de outro cliente: a API responde 404 e o site só repassa o status. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const pedido = normalizarPedidoDetalhe(await chamarApi<Record<string, unknown>>(`/pedidos/${id}`, { token }));
    const mapa = await fotos(pedido.itens.map((i) => i.produtoId ?? ''));
    pedido.itens = pedido.itens.map((i) => ({ ...i, imagemUrl: (i.produtoId && mapa.get(i.produtoId)) || null }));
    return respostaJson(pedido);
  });
}
