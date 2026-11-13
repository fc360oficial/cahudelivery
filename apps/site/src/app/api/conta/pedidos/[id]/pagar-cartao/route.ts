import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { resultadoCartao, validarPagamentoCartao } from '@/lib/checkout/cartao';
import { criarLimite, sujeitoDoJwt } from '@/lib/conta/limite-tentativas';
import { corpoInvalido, lerCorpo, naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

/** 5 tentativas recusadas em 15 minutos travam o cartão desse cliente no site (freio contra teste de cartões). */
const tentativas = criarLimite({ maximo: 5, janelaMs: 15 * 60 * 1000 });
const MUITAS_TENTATIVAS = 'Muitas tentativas de pagamento com cartão. Aguarde 15 minutos ou pague com PIX.';

/** Erro da API que conta como tentativa recusada: 4xx do pagamento, menos sessão (401) e "em processamento" (409). */
const contaComoRecusa = (e: unknown) => e instanceof ErroApi && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 409;

/**
 * POST pedidos/:id/pagar-cartao. Os dados do cartão ficam só nesta requisição (memória), vão
 * direto à API e nunca são gravados, logados nem devolvidos. Vai com X-Canal: site (a volta do
 * 3DS cai na página do pedido no site), o IP e o User-Agent do visitante (antifraude/3DS) e os
 * dados de tela/idioma/fuso coletados no navegador. A resposta é só o resultado.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const dados = validarPagamentoCartao(await lerCorpo(req), new Date());
    if (!dados) return corpoInvalido('Confira os dados do cartão: número, nome impresso, validade e código de segurança.');
    const chave = sujeitoDoJwt(token);
    if (chave && tentativas.bloqueado(chave, Date.now())) return respostaJson({ mensagem: MUITAS_TENTATIVAS }, 429);
    let bruto: unknown;
    try {
      bruto = await chamarApi<unknown>(`/pedidos/${id.toLowerCase()}/pagar-cartao`, {
        metodo: 'POST',
        corpo: dados,
        token,
        canal: 'site',
        ipCliente: ipDoVisitante(req.headers),
        userAgent: req.headers.get('user-agent') ?? undefined,
      });
    } catch (e) {
      if (chave && contaComoRecusa(e)) tentativas.registrarFalha(chave, Date.now());
      throw e;
    }
    const resultado = resultadoCartao(bruto);
    if (chave && resultado.status === 'recusado') tentativas.registrarFalha(chave, Date.now());
    if (chave && resultado.status === 'pago') tentativas.limpar(chave);
    return respostaJson(resultado);
  }, { mudaEstado: true });
}
