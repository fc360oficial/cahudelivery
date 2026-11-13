import { chamarApi } from '@/lib/api/cliente';
import { normalizarEndereco, normalizarEnderecos } from '@/lib/conta/normalizar-conta';
import { corpoInvalido, lerCorpo, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { MENSAGEM_ENDERECO_INVALIDO, validarEndereco } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/** GET perfil/enderecos. */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => respostaJson(normalizarEnderecos(await chamarApi<unknown>('/perfil/enderecos', { token }))));
}

/** POST perfil/enderecos. */
export async function POST(req: Request) {
  return rotaDaConta(req, async (token) => {
    const dados = validarEndereco(await lerCorpo(req));
    if (!dados) return corpoInvalido(MENSAGEM_ENDERECO_INVALIDO);
    const bruto = await chamarApi<Record<string, unknown>>('/perfil/enderecos', { metodo: 'POST', corpo: dados, token });
    return respostaJson(normalizarEndereco(bruto), 201);
  }, { mudaEstado: true });
}
