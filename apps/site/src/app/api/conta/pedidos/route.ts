import { chamarApi } from '@/lib/api/cliente';
import { normalizarPaginaPedidos } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarPagina } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/** GET pedidos?pagina=n (20 por página, como a API). */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => {
    const pagina = validarPagina(new URL(req.url).searchParams.get('pagina'));
    const bruto = await chamarApi<Record<string, unknown>>(`/pedidos?pagina=${pagina}`, { token });
    return respostaJson(normalizarPaginaPedidos(bruto));
  });
}
