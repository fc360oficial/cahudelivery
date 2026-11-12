import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { lerDispositivo } from '@/lib/sessao/dispositivo';
import { requisicaoSegura } from '@/lib/sessao/requisicao';
import { apagarSessao, tokenValido } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };
const SESSAO_EXPIROU = 'Sua sessão expirou. Entre novamente.';

export async function GET(req: Request) {
  try {
    // Cliente logado: carrinho dele (o mesmo do app), sem depender do dispositivo.
    const token = await tokenValido(requisicaoSegura(req.headers, req.url));
    if (token) {
      try {
        const bruto = await chamarApi<Record<string, unknown>>('/carrinho', { token });
        return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
      } catch (e) {
        if (e instanceof ErroApi && e.status === 401) {
          await apagarSessao();
          return NextResponse.json({ mensagem: SESSAO_EXPIROU }, { status: 401, headers: SEM_CACHE });
        }
        throw e;
      }
    }
    const deviceId = await lerDispositivo();
    // Visitante que nunca adicionou nada: não cria linha de carrinho na API.
    if (!deviceId) return NextResponse.json({ itens: [], subtotal: 0 }, { headers: SEM_CACHE });
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho', { deviceId });
    return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status, headers: SEM_CACHE });
  }
}
