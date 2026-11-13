import { chamarApi } from '@/lib/api/cliente';
import { normalizarCredito } from '@/lib/conta/normalizar-conta';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';

export const dynamic = 'force-dynamic';

/** POST credito/solicitar (idempotente na API: uma solicitação pendente por cliente). Sem corpo. */
export async function POST(req: Request) {
  return rotaDaConta(req, async (token) => {
    const bruto = await chamarApi<Record<string, unknown>>('/credito/solicitar', { metodo: 'POST', token });
    return respostaJson(normalizarCredito(bruto));
  }, { mudaEstado: true });
}
