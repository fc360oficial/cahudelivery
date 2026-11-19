import { NextResponse } from 'next/server';
import { buscarTodosProdutos } from '@/lib/api/catalogo';
import { itemDeBusca } from '@/lib/catalogo/sugestoes';

export const dynamic = 'force-dynamic';

/**
 * Índice do catálogo para a busca com sugestões do cabeçalho: nome, embalagem, preço, foto pequena e códigos de
 * cada produto à venda. É o mesmo preço público das vitrines (sem dado de cliente), por isso pode ficar 1 minuto
 * guardado no navegador; a lista por trás já fica em cache no servidor pelo mesmo tempo.
 */
export async function GET() {
  try {
    const { dados } = await buscarTodosProdutos({ ordem: 'nome' });
    return NextResponse.json(dados.map(itemDeBusca), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    // sem o índice a busca continua funcionando com Enter (página /busca); só não abre as sugestões
    return NextResponse.json({ mensagem: 'Sugestões indisponíveis agora.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
