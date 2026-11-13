import { chamarApi } from '@/lib/api/cliente';
import { normalizarPaginaNotas } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarPagina } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/** GET pedidos/notas?pagina=n. As URLs dos arquivos ficam no servidor (ao navegador só vão flags). */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => {
    const pagina = validarPagina(new URL(req.url).searchParams.get('pagina'));
    const bruto = await chamarApi<Record<string, unknown>>(`/pedidos/notas?pagina=${pagina}`, { token });
    return respostaJson(normalizarPaginaNotas(bruto));
  });
}
