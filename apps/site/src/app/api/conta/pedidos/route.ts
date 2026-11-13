import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { buscarConfig } from '@/lib/api/catalogo';
import { normalizarPedidoCriado, validarPedido } from '@/lib/checkout/pedido';
import { normalizarPaginaPedidos } from '@/lib/conta/normalizar-conta';
import { corpoInvalido, lerCorpo, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarPagina } from '@/lib/conta/validar';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

/** GET pedidos?pagina=n (20 por página, como a API). */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => {
    const pagina = validarPagina(new URL(req.url).searchParams.get('pagina'));
    const bruto = await chamarApi<Record<string, unknown>>(`/pedidos?pagina=${pagina}`, { token });
    return respostaJson(normalizarPaginaPedidos(bruto));
  });
}

/**
 * POST pedidos: fecha o pedido com o carrinho que a API já tem. O site manda só as escolhas
 * (entrega, endereço, forma, condição do boleto, saldo, observações): preço, total, mínimo,
 * estoque, crédito e bloqueios são da API. Vai com X-Canal: site e com o IP e o navegador do
 * visitante (aceite do pedido / antifraude). A API não tem chave de idempotência; um segundo
 * envio encontra o carrinho já esvaziado pela transação do primeiro e é recusado ("Carrinho vazio").
 */
export async function POST(req: Request) {
  return rotaDaConta(req, async (token) => {
    const corpo = await lerCorpo(req);
    const config = await buscarConfig();
    const dados = validarPedido(corpo, config.condicoesBoleto);
    if (!dados) return corpoInvalido('Confira a entrega, o endereço e a forma de pagamento.');
    const bruto = await chamarApi<unknown>('/pedidos', {
      metodo: 'POST',
      corpo: dados,
      token,
      canal: 'site',
      ipCliente: ipDoVisitante(req.headers),
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    const pedido = normalizarPedidoCriado(bruto);
    // Pedido criado mas resposta fora do formato: a tela manda conferir em "Meus pedidos".
    if (!pedido) throw new ErroApi(502, 'Resposta inesperada do servidor.');
    return respostaJson(pedido, 201);
  }, { mudaEstado: true });
}
