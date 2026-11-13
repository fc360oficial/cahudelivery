import { consultarCep } from '@/lib/cep/consultar-cep';
import { respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { validarCep } from '@/lib/conta/validar';

export const dynamic = 'force-dynamic';

/**
 * Busca de CEP igual à do app (ViaCEP), feita pelo servidor do site (ver consultarCep). Exige
 * sessão; a versão para visitante é /api/cep/[cep], com limite por IP e cache.
 */
export async function GET(req: Request, { params }: { params: Promise<{ cep: string }> }) {
  return rotaDaConta(req, async () => {
    const cep = validarCep((await params).cep);
    if (!cep) return respostaJson({ mensagem: 'CEP inválido.' }, 400);
    const r = await consultarCep(cep);
    if (r.tipo === 'invalido') return respostaJson({ mensagem: 'CEP inválido.' }, 400);
    if (r.tipo === 'falha') return respostaJson({ mensagem: 'Não foi possível buscar o CEP agora. Preencha o endereço à mão.' }, 503);
    if (r.tipo === 'nao-encontrado') return respostaJson({ mensagem: 'CEP não encontrado.' }, 404);
    const { logradouro, bairro, cidade, uf } = r.endereco;
    return respostaJson({ logradouro, bairro, cidade, uf });
  });
}
