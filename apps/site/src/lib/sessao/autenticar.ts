import 'server-only';
import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { erroDeAutenticacao } from './credenciais';
import { lerDispositivo } from './dispositivo';
import { origemConfere } from './origem';
import { requisicaoSegura } from './requisicao';
import { gravarSessao, ipDoVisitante, parValido } from './sessao-cliente';

export const SEM_CACHE = { 'Cache-Control': 'no-store' };

/** 403 quando o POST/DELETE não veio do próprio site; nulo quando confere. */
export function recusarOrigem(req: Request): NextResponse | null {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origemConfere(req.headers.get('origin'), host)) return null;
  return NextResponse.json({ mensagem: 'Origem não permitida.' }, { status: 403, headers: SEM_CACHE });
}

/**
 * Login ou primeiro acesso na API: grava o par de tokens em cookie HttpOnly e devolve ao
 * navegador só `{ logado, status }`. Manda o X-Device-Id (se houver) para a API passar o
 * carrinho do visitante para o cliente, e o IP do visitante para o limite de tentativas.
 */
export async function autenticar(req: Request, caminho: '/auth/login' | '/auth/primeiro-acesso', corpo: object) {
  try {
    const resposta = await chamarApi<unknown>(caminho, {
      metodo: 'POST',
      corpo,
      deviceId: (await lerDispositivo()) ?? undefined,
      ipCliente: ipDoVisitante(req.headers),
    });
    if (!parValido(resposta)) throw new ErroApi(502, 'Resposta inesperada do servidor.');
    await gravarSessao(resposta, requisicaoSegura(req.headers, req.url));
    const bruto = (resposta as { status?: unknown }).status;
    const status = typeof bruto === 'string' ? bruto : null;
    return NextResponse.json({ logado: true, status }, { headers: SEM_CACHE });
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado.');
    const { status, corpo: corpoErro } = erroDeAutenticacao(erro.status, erro.message, erro.codigo);
    return NextResponse.json(corpoErro, { status, headers: SEM_CACHE });
  }
}
