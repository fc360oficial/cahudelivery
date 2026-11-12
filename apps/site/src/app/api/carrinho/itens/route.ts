import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { garantirDispositivo } from '@/lib/sessao/dispositivo';
import { validarItem } from '@/lib/sessao/item';
import { origemConfere } from '@/lib/sessao/origem';
import { requisicaoSegura } from '@/lib/sessao/requisicao';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function PUT(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origemConfere(req.headers.get('origin'), host)) {
    return NextResponse.json({ mensagem: 'Origem não permitida.' }, { status: 403, headers: SEM_CACHE });
  }
  const item = validarItem(await req.json().catch(() => null));
  if (!item) return NextResponse.json({ mensagem: 'Item inválido.' }, { status: 400, headers: SEM_CACHE });

  try {
    const deviceId = await garantirDispositivo(requisicaoSegura(req.headers, req.url));
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho/itens', { metodo: 'PUT', corpo: item, deviceId });
    return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status, headers: SEM_CACHE });
  }
}
