import { chamarApi } from '@/lib/api/cliente';
import { normalizarPerfil } from '@/lib/conta/normalizar-conta';
import { corpoInvalido, lerCorpo, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarPerfil } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

type Bruto = Record<string, unknown>;

/** GET perfil: dados cadastrais do próprio cliente (quem é vem do token, nunca do navegador). */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => respostaJson(normalizarPerfil(await chamarApi<Bruto>('/perfil', { token }))));
}

/** PUT perfil: só nome fantasia e telefone (o que o PerfilDto da API aceita). */
export async function PUT(req: Request) {
  return rotaDaConta(req, async (token) => {
    const dados = validarPerfil(await lerCorpo(req));
    if (!dados) return corpoInvalido('Informe o nome fantasia (2 a 120 caracteres) e um telefone com DDD.');
    const bruto = await chamarApi<Bruto>('/perfil', { metodo: 'PUT', corpo: dados, token });
    return respostaJson(normalizarPerfil(bruto));
  }, { mudaEstado: true });
}
