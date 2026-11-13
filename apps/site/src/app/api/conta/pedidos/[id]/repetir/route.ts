import { chamarApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

/**
 * POST pedidos/:id/repetir. A API (orders.service.ts › repetir) põe no carrinho do cliente cada
 * produto ATIVO do pedido com a quantidade do pedido: o que já estava no carrinho continua, mas
 * um produto que já estava nele passa a ter a quantidade do pedido (não soma). Antes, confere o
 * pedido pelo GET pedidos/:id: o repetir de um pedido alheio responderia 200 sem mexer em nada.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    await chamarApi<unknown>(`/pedidos/${id}`, { token });
    const bruto = await chamarApi<Record<string, unknown>>(`/pedidos/${id}/repetir`, { metodo: 'POST', token });
    return respostaJson(normalizarCarrinho(bruto));
  }, { mudaEstado: true });
}
