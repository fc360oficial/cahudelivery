import { chamarApi } from '@/lib/api/cliente';
import { naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

const STATUS = new Set(['pago', 'pendente', 'recusado', 'expirado', 'cancelado', 'falhou', 'estorno_solicitado', 'estornado', 'creditado']);

/**
 * POST pedidos/:id/pagar-cartao/confirmar: depois do desafio 3DS, a API consulta a Rede e devolve
 * o status REAL do pagamento. É isto (e o GET do pedido) que a tela mostra, nunca o ?pagamento=.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const r = await chamarApi<{ status?: unknown }>(`/pedidos/${id.toLowerCase()}/pagar-cartao/confirmar`, { metodo: 'POST', corpo: {}, token });
    const status = typeof r?.status === 'string' && STATUS.has(r.status) ? r.status : 'desconhecido';
    return respostaJson({ status });
  }, { mudaEstado: true });
}
