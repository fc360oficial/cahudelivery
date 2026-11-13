import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { senhaAtualRecusada } from '@/lib/conta/erros';
import { criarLimite, sujeitoDoJwt } from '@/lib/conta/limite-tentativas';
import { corpoInvalido, lerCorpo, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarTrocaSenha } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/** 5 senhas atuais erradas em 15 minutos travam novas tentativas dessa conta por esse período. */
const tentativas = criarLimite({ maximo: 5, janelaMs: 15 * 60 * 1000 });
const MUITAS_TENTATIVAS = 'Muitas tentativas com a senha atual errada. Aguarde 15 minutos e tente de novo.';

/** POST auth/senha: troca a senha (atual + nova). A sessão continua valendo. */
export async function POST(req: Request) {
  return rotaDaConta(req, async (token) => {
    const dados = validarTrocaSenha(await lerCorpo(req));
    if (!dados) return corpoInvalido('Informe a senha atual e uma senha nova diferente, com no mínimo 6 caracteres.');
    // Sem `sub` legível o token é inválido: a API vai recusar e nenhuma falha é contada.
    const chave = sujeitoDoJwt(token);
    if (chave && tentativas.bloqueado(chave, Date.now())) return respostaJson({ mensagem: MUITAS_TENTATIVAS }, 429);
    try {
      await chamarApi<unknown>('/auth/senha', { metodo: 'POST', corpo: dados, token });
    } catch (e) {
      // 401 com texto = senha atual errada (não é sessão vencida): vira 400 para a tela mostrar.
      if (e instanceof ErroApi && senhaAtualRecusada(e.status, e.message)) {
        if (chave) tentativas.registrarFalha(chave, Date.now());
        return corpoInvalido(e.message);
      }
      throw e;
    }
    if (chave) tentativas.limpar(chave);
    return respostaJson({ ok: true });
  }, { mudaEstado: true });
}
