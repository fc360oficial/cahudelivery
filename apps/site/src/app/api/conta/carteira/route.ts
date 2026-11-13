import { chamarApi } from '@/lib/api/cliente';
import { normalizarCarteira } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';

export const dynamic = 'force-dynamic';

/** GET carteira: saldo e as últimas 50 movimentações. */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => respostaJson(normalizarCarteira(await chamarApi<Record<string, unknown>>('/carteira', { token }))));
}
