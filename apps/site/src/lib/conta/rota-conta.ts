import 'server-only';
import { NextResponse } from 'next/server';
import { ErroApi } from '@/lib/api/cliente';
import { recusarOrigem, respostaSessaoExpirou, SEM_CACHE } from '@/lib/sessao/autenticar';
import { requisicaoSegura } from '@/lib/sessao/requisicao';
import { estadoDaSessao } from '@/lib/sessao/sessao-cliente';
import { erroDaConta } from './erros';

/** JSON sem cache (dado de um cliente nunca pode ficar guardado para outro). */
export const respostaJson = (dados: unknown, status = 200) => NextResponse.json(dados, { status, headers: SEM_CACHE });

export const corpoInvalido = (mensagem: string) => respostaJson({ mensagem }, 400);

/** Id fora do formato: mesma resposta que a API dá para id que não é do cliente. */
export const naoEncontrado = () => respostaJson({ mensagem: 'Não encontrado.' }, 404);

/**
 * Esqueleto de toda rota /api/conta/*:
 *  1. muda estado? confere Origin antes de tudo (403);
 *  2. sem sessão (visitante ou expirada) → 401 com a mensagem de sessão expirada;
 *  3. chama `acao` com o access token (que nunca sai do servidor);
 *  4. 401 da API → sessão expirada (apaga cookies); outros erros → erroDaConta (sem corpo bruto).
 * Validação do corpo fica dentro de `acao`, depois da sessão: sem sessão a resposta é sempre 401.
 */
export async function rotaDaConta(
  req: Request,
  acao: (token: string) => Promise<NextResponse>,
  opcoes: { mudaEstado?: boolean } = {},
): Promise<NextResponse> {
  if (opcoes.mudaEstado) {
    const recusa = recusarOrigem(req);
    if (recusa) return recusa;
  }
  try {
    const sessao = await estadoDaSessao(requisicaoSegura(req.headers, req.url));
    if (sessao.estado !== 'logado') return await respostaSessaoExpirou(req);
    return await acao(sessao.token);
  } catch (e) {
    if (e instanceof ErroApi && e.status === 401) return await respostaSessaoExpirou(req);
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado.');
    const { status, corpo } = erroDaConta(erro.status, erro.message);
    return respostaJson(corpo, status);
  }
}

/** Lê o corpo JSON sem lançar; corpo grande demais ou inválido vira nulo. */
export async function lerCorpo(req: Request): Promise<unknown> {
  const tamanho = Number(req.headers.get('content-length') ?? 0);
  if (tamanho > 16 * 1024) return null;
  return req.json().catch(() => null);
}
