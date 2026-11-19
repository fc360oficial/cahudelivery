import { chamarApi } from '@/lib/api/cliente';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { normalizarFavoritos } from '@/lib/favoritos/ids';

export const dynamic = 'force-dynamic';

/** GET favoritos: os ids dos produtos que o cliente marcou (os mesmos do app). */
export async function GET(req: Request) {
  return rotaDaConta(req, async (token) => respostaJson(normalizarFavoritos(await chamarApi<unknown>('/favoritos', { token }))));
}
