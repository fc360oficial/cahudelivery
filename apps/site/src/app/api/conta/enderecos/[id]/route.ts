import { chamarApi } from '@/lib/api/cliente';
import { normalizarEndereco } from '@/lib/conta/normalizar-conta';
import { corpoInvalido, lerCorpo, naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { MENSAGEM_ENDERECO_INVALIDO, validarEndereco } from '@/lib/conta/validar';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

type Contexto = { params: Promise<{ id: string }> };

/** PUT perfil/enderecos/:id. Endereço de outro cliente: a API responde 404 e o site repassa. */
export async function PUT(req: Request, { params }: Contexto) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const dados = validarEndereco(await lerCorpo(req));
    if (!dados) return corpoInvalido(MENSAGEM_ENDERECO_INVALIDO);
    const bruto = await chamarApi<Record<string, unknown>>(`/perfil/enderecos/${id}`, { metodo: 'PUT', corpo: dados, token });
    return respostaJson(normalizarEndereco(bruto));
  }, { mudaEstado: true });
}

/** DELETE perfil/enderecos/:id. A API recusa (400) endereço já usado em pedido, com a mensagem dela. */
export async function DELETE(req: Request, { params }: Contexto) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    await chamarApi<unknown>(`/perfil/enderecos/${id}`, { metodo: 'DELETE', token });
    return respostaJson({ ok: true });
  }, { mudaEstado: true });
}
