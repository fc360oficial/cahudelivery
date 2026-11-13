import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { senhaAtualRecusada } from '@/lib/conta/erros';
import { corpoInvalido, lerCorpo, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarTrocaSenha } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/** POST auth/senha: troca a senha (atual + nova). A sessão continua valendo. */
export async function POST(req: Request) {
  return rotaDaConta(req, async (token) => {
    const dados = validarTrocaSenha(await lerCorpo(req));
    if (!dados) return corpoInvalido('Informe a senha atual e uma senha nova diferente, com no mínimo 6 caracteres.');
    try {
      await chamarApi<unknown>('/auth/senha', { metodo: 'POST', corpo: dados, token });
    } catch (e) {
      // 401 com texto = senha atual errada (não é sessão vencida): vira 400 para a tela mostrar.
      if (e instanceof ErroApi && senhaAtualRecusada(e.status, e.message)) return corpoInvalido(e.message);
      throw e;
    }
    return respostaJson({ ok: true });
  }, { mudaEstado: true });
}
