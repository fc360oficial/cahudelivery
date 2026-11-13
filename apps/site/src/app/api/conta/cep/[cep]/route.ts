import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarCep } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

const curto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Busca de CEP igual à do app (ViaCEP), mas feita pelo servidor do site: o navegador só fala com
 * /api (CSP connect-src 'self'). Exige sessão para não virar proxy aberto. Sem cache: o cache de
 * fetch do Next junto com o AbortSignal fazia a busca falhar (503) no next dev.
 */
export async function GET(req: Request, { params }: { params: Promise<{ cep: string }> }) {
  return rotaDaConta(req, async () => {
    const cep = validarCep((await params).cep);
    if (!cep) return respostaJson({ mensagem: 'CEP inválido.' }, 400);
    let dados: Record<string, unknown> | null;
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error(String(r.status));
      dados = (await r.json()) as Record<string, unknown> | null;
    } catch {
      return respostaJson({ mensagem: 'Não foi possível buscar o CEP agora. Preencha o endereço à mão.' }, 503);
    }
    if (!dados || typeof dados !== 'object' || dados.erro) return respostaJson({ mensagem: 'CEP não encontrado.' }, 404);
    return respostaJson({
      logradouro: curto(dados.logradouro, 120),
      bairro: curto(dados.bairro, 80),
      cidade: curto(dados.localidade, 80),
      uf: curto(dados.uf, 2).toUpperCase(),
    });
  });
}
