import { chamarApi } from '@/lib/api/cliente';
import { normalizarCredito } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';

export const dynamic = 'force-dynamic';

/** GET credito: a API só diz se há análise de crédito pendente. */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => respostaJson(normalizarCredito(await chamarApi<Record<string, unknown>>('/credito', { token }))));
}
