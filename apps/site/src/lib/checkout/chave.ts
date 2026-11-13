import 'server-only';
import type { NextResponse } from 'next/server';
import { buscarConfig } from '@/lib/api/catalogo';
import { respostaJson } from '@/lib/conta/rota-conta';
import { checkoutLigado } from '@/lib/site';

/**
 * Rotas que criam pedido ou cobram: com CHECKOUT_LIGADO desligado respondem 503 sem chamar a rota
 * da API e antes de validar o corpo (Origin e sessão já foram conferidas por rotaDaConta). Só lê a
 * config pública (com cache) para o nome do app; se ela falhar, a mensagem sai sem o nome.
 */
export async function recusaCheckoutDesligado(): Promise<NextResponse | null> {
  if (checkoutLigado()) return null;
  const appNome = await buscarConfig().then((c) => c.appNome.trim()).catch(() => '');
  const app = appNome ? `app ${appNome}` : 'app';
  return respostaJson({ mensagem: `O fechamento de pedido pelo site ainda não está disponível. Finalize pelo ${app}.` }, 503);
}
