import { NextResponse } from 'next/server';
import { chamarApi } from '@/lib/api/cliente';
import { svgDoPix } from '@/lib/checkout/qr-pix';
import { normalizarPedidoDetalhe } from '@/lib/conta/normalizar-conta';
import { naoEncontrado, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const dynamic = 'force-dynamic';

/**
 * GET: o QR do PIX pendente do pedido, em SVG, desenhado aqui a partir do copia-e-cola que a API
 * devolve no GET pedidos/:id (do próprio cliente: pedido alheio dá 404 na API). Nada de serviço
 * externo de QR e nada vindo do navegador entra no desenho. Sem PIX pendente: 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const pedido = normalizarPedidoDetalhe(await chamarApi<Record<string, unknown>>(`/pedidos/${id}`, { token }));
    const codigo = pedido.status === 'AGUARDANDO_PAGAMENTO' ? pedido.pagamento?.copiaCola : null;
    if (!codigo) return naoEncontrado();
    return new NextResponse(await svgDoPix(codigo), {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        // Aberto direto na aba, o SVG não roda nada.
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  });
}
