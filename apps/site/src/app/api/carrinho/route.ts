import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { lerDispositivo } from '@/lib/sessao/dispositivo';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET() {
  const deviceId = await lerDispositivo();
  // Visitante que nunca adicionou nada: não cria linha de carrinho na API.
  if (!deviceId) return NextResponse.json({ itens: [], subtotal: 0 }, { headers: SEM_CACHE });
  try {
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho', { deviceId });
    return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status, headers: SEM_CACHE });
  }
}
