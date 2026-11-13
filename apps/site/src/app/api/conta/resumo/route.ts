import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarteira, normalizarCredito, normalizarPaginaPedidos, normalizarPerfil } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import type { ResumoConta } from '@/lib/conta/tipos';

export const dynamic = 'force-dynamic';

type Bruto = Record<string, unknown>;

/** Cartão que falhar (erro da API) some da visão geral; sessão vencida (401) derruba tudo. */
const opcional = <T,>(p: Promise<T>): Promise<T | null> =>
  p.catch((e: unknown) => {
    if (e instanceof ErroApi && e.status === 401) throw e;
    return null;
  });

/** Visão geral: GET perfil + GET pedidos (1ª página) + GET credito + GET carteira. */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => {
    const [perfil, pedidos, credito, carteira] = await Promise.all([
      chamarApi<Bruto>('/perfil', { token }),
      opcional(chamarApi<Bruto>('/pedidos?pagina=1', { token })),
      opcional(chamarApi<Bruto>('/credito', { token })),
      opcional(chamarApi<Bruto>('/carteira', { token })),
    ]);
    const resumo: ResumoConta = {
      perfil: normalizarPerfil(perfil),
      ultimoPedido: pedidos ? normalizarPaginaPedidos(pedidos).dados[0] ?? null : null,
      credito: credito ? normalizarCredito(credito) : null,
      carteira: carteira ? { saldo: normalizarCarteira(carteira).saldo } : null,
    };
    return respostaJson(resumo);
  });
}
