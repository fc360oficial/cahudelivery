import { chamarApi } from '@/lib/api/cliente';
import { naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ produtoId: string }> };

async function alterar(req: Request, { params }: Contexto, metodo: 'POST' | 'DELETE') {
  return rotaDaConta(req, async (token) => {
    const { produtoId } = await params;
    if (!UUID_INTEIRO.test(produtoId)) return naoEncontrado();
    await chamarApi<unknown>(`/favoritos/${produtoId.toLowerCase()}`, { metodo, token });
    return respostaJson({ ok: true });
  }, { mudaEstado: true });
}

/** POST favoritos/:produtoId. Marcar de novo o que já está marcado não é erro. */
export async function POST(req: Request, contexto: Contexto) {
  return alterar(req, contexto, 'POST');
}

/** DELETE favoritos/:produtoId. */
export async function DELETE(req: Request, contexto: Contexto) {
  return alterar(req, contexto, 'DELETE');
}
