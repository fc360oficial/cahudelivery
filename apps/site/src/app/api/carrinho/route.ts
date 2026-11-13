import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { respostaSessaoExpirou, SEM_CACHE } from '@/lib/sessao/autenticar';
import { lerDispositivo } from '@/lib/sessao/dispositivo';
import { requisicaoSegura } from '@/lib/sessao/requisicao';
import { estadoDaSessao } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const sessao = await estadoDaSessao(requisicaoSegura(req.headers, req.url));
    // Havia sessão e ela morreu: avisa (401) em vez de mostrar o carrinho do aparelho como se fosse dele.
    if (sessao.estado === 'expirada') return await respostaSessaoExpirou(req);
    // Cliente logado: carrinho dele (o mesmo do app), sem depender do dispositivo.
    if (sessao.estado === 'logado') {
      try {
        const bruto = await chamarApi<Record<string, unknown>>('/carrinho', { token: sessao.token });
        return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
      } catch (e) {
        if (e instanceof ErroApi && e.status === 401) return await respostaSessaoExpirou(req);
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
