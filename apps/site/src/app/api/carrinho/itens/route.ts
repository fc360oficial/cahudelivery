import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { recusarOrigem, respostaSessaoExpirou, SEM_CACHE } from '@/lib/sessao/autenticar';
import { garantirDispositivo } from '@/lib/sessao/dispositivo';
import { validarItem } from '@/lib/sessao/item';
import { requisicaoSegura } from '@/lib/sessao/requisicao';
import { estadoDaSessao } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const recusa = recusarOrigem(req);
  if (recusa) return recusa;
  const item = validarItem(await req.json().catch(() => null));
  if (!item) return NextResponse.json({ mensagem: 'Item inválido.' }, { status: 400, headers: SEM_CACHE });

  try {
    const seguro = requisicaoSegura(req.headers, req.url);
    const sessao = await estadoDaSessao(seguro);
    // Havia sessão e ela morreu: 401, nunca gravar no carrinho do aparelho.
    if (sessao.estado === 'expirada') return await respostaSessaoExpirou(req);
    if (sessao.estado === 'logado') {
      try {
        const bruto = await chamarApi<Record<string, unknown>>('/carrinho/itens', { metodo: 'PUT', corpo: item, token: sessao.token });
        return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
      } catch (e) {
        if (e instanceof ErroApi && e.status === 401) return await respostaSessaoExpirou(req);
        throw e;
      }
    }
    const deviceId = await garantirDispositivo(seguro);
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho/itens', { metodo: 'PUT', corpo: item, deviceId });
    return NextResponse.json(normalizarCarrinho(bruto), { headers: SEM_CACHE });
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status, headers: SEM_CACHE });
  }
}
