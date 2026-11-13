import { NextResponse } from 'next/server';
import { baixarArquivoApi, chamarApi, tenantDoSite } from '@/lib/api/cliente';
import { normalizarPedidoDetalhe } from '@/lib/conta/normalizar-conta';
import { caminhoArquivoNota, nomeArquivoNota, type ArquivoNota } from '@/lib/conta/notas';
import { naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

const ARQUIVOS: Record<string, { arquivo: ArquivoNota; tipo: string; disposicao: 'inline' | 'attachment' }> = {
  'danfe.pdf': { arquivo: 'danfe', tipo: 'application/pdf', disposicao: 'inline' },
  'nota.xml': { arquivo: 'xml', tipo: 'application/xml; charset=utf-8', disposicao: 'attachment' },
};

/**
 * DANFE (PDF) e XML da NF-e, servidos pelo site. A API grava uma URL absoluta e assinada (HMAC,
 * sem validade) pensada para o navegador do app; aqui ela NÃO vai para o navegador: o dono do
 * pedido é conferido pelo GET pedidos/:id com o token do cliente (404 se não for dele), a URL
 * dessa resposta dá a assinatura, e o arquivo é buscado no API_URL do próprio servidor.
 */
export async function GET(req: Request, { params }: { params: Promise<{ pedidoId: string; arquivo: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { pedidoId, arquivo } = await params;
    const alvo = Object.hasOwn(ARQUIVOS, arquivo) ? ARQUIVOS[arquivo] : undefined;
    if (!alvo || !UUID_INTEIRO.test(pedidoId)) return naoEncontrado();

    const bruto = await chamarApi<Record<string, unknown>>(`/pedidos/${pedidoId}`, { token });
    const notaBruta = bruto.nota && typeof bruto.nota === 'object' ? (bruto.nota as Record<string, unknown>) : null;
    const url = alvo.arquivo === 'danfe' ? notaBruta?.pdf_url : notaBruta?.xml_url;
    const caminho = caminhoArquivoNota(url, pedidoId, alvo.arquivo, tenantDoSite());
    const nota = normalizarPedidoDetalhe(bruto).nota;
    if (!caminho || !nota) return respostaJson({ mensagem: 'Arquivo da nota indisponível.' }, 404);

    const { corpo } = await baixarArquivoApi(caminho);
    return new NextResponse(corpo, {
      headers: {
        'Content-Type': alvo.tipo,
        'Content-Disposition': `${alvo.disposicao}; filename="${nomeArquivoNota(alvo.arquivo, nota)}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}
