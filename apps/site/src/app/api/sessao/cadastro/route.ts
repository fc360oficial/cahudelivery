import { NextResponse } from 'next/server';
import { erroDoCadastro } from '@/lib/cadastro/erros';
import { caiuNaArmadilha, validarCadastro } from '@/lib/cadastro/validar-cadastro';
import { criarLimite } from '@/lib/conta/limite-tentativas';
import { lerCorpo } from '@/lib/conta/rota-conta';
import { autenticar, recusarOrigem, SEM_CACHE } from '@/lib/sessao/autenticar';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

/**
 * 5 cadastros que chegam à API por hora por IP do visitante (a API não limita o auth/registrar).
 * Corpo recusado aqui no site não conta. Vale por processo, como os outros limites do site.
 */
const tentativas = criarLimite({ maximo: 5, janelaMs: 60 * 60 * 1000 });
const MUITAS_TENTATIVAS =
  'Muitas tentativas de cadastro a partir desta conexão. Aguarde uma hora e tente de novo, ou fale com a distribuidora.';

/**
 * Cadastro de cliente novo (POST auth/registrar). Mesmas regras do login: Origin conferido antes
 * de tudo, corpo validado aqui com tamanhos máximos, tokens só em cookie HttpOnly e ao navegador
 * só `{ logado, status }`. O cadastro nasce "em análise" na API; o carrinho do visitante passa
 * para o cliente pelo X-Device-Id. A senha não é registrada em lugar nenhum.
 */
export async function POST(req: Request) {
  const recusa = recusarOrigem(req);
  if (recusa) return recusa;
  const corpo = await lerCorpo(req);

  // Robô que preencheu o campo invisível: parece sucesso, mas nada vai à API e nenhuma sessão nasce.
  if (caiuNaArmadilha(corpo)) return NextResponse.json({ logado: true, status: 'pendente' }, { headers: SEM_CACHE });

  const validacao = validarCadastro(corpo);
  if (!validacao.ok) {
    return NextResponse.json(
      { mensagem: 'Confira os campos destacados.', erros: validacao.erros },
      { status: 400, headers: SEM_CACHE },
    );
  }

  const agora = Date.now();
  const chave = ipDoVisitante(req.headers) ?? 'sem-ip';
  if (tentativas.bloqueado(chave, agora)) {
    return NextResponse.json({ mensagem: MUITAS_TENTATIVAS }, { status: 429, headers: SEM_CACHE });
  }
  tentativas.registrarFalha(chave, agora);
  return autenticar(req, '/auth/registrar', validacao.dados, erroDoCadastro);
}
