import { chamarApi, TEMPO_LIMITE_PAGAMENTO_MS } from '@/lib/api/cliente';
import { recusaCheckoutDesligado } from '@/lib/checkout/chave';
import { resultadoCartao, validarPagamentoCartao, type ResultadoCartao } from '@/lib/checkout/cartao';
import { criarLimite, sujeitoDoJwt } from '@/lib/conta/limite-tentativas';
import { corpoInvalido, lerCorpo, naoEncontrado, respostaJson, rotaDaConta } from '@/lib/conta/rota-conta';
import { UUID_INTEIRO } from '@/lib/formato/caminhos';
import { ipDoVisitante } from '@/lib/sessao/sessao-cliente';

export const dynamic = 'force-dynamic';

/** 5 tentativas recusadas em 15 minutos travam o cartão desse cliente no site (freio contra teste de cartões). */
const tentativas = criarLimite({ maximo: 5, janelaMs: 15 * 60 * 1000 });
const MUITAS_TENTATIVAS = 'Muitas tentativas de pagamento com cartão. Aguarde 15 minutos ou pague com PIX.';

/**
 * Só a recusa real do cartão conta para o limite: resposta 200 da API com `status: 'recusado'`.
 * Erro da API (4xx/5xx: provedor fora do ar, "indisponível", pedido sem cartão, em processamento)
 * não é tentativa de cartão e nunca trava o cliente.
 */
const contaComoRecusa = (r: ResultadoCartao) => r.status === 'recusado';

/**
 * POST pedidos/:id/pagar-cartao. Os dados do cartão ficam só nesta requisição (memória), vão
 * direto à API e nunca são gravados, logados nem devolvidos. Vai com X-Canal: site (a volta do
 * 3DS cai na página do pedido no site), o IP e o User-Agent do visitante (antifraude/3DS) e os
 * dados de tela/idioma/fuso coletados no navegador. A resposta é só o resultado.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return rotaDaConta(req, async (token) => {
    const desligado = await recusaCheckoutDesligado();
    if (desligado) return desligado;
    const { id } = await params;
    if (!UUID_INTEIRO.test(id)) return naoEncontrado();
    const dados = validarPagamentoCartao(await lerCorpo(req), new Date());
    if (!dados) return corpoInvalido('Confira os dados do cartão: número, nome impresso, validade e código de segurança.');
    const chave = sujeitoDoJwt(token);
    if (chave && tentativas.bloqueado(chave, Date.now())) return respostaJson({ mensagem: MUITAS_TENTATIVAS }, 429);
    const bruto = await chamarApi<unknown>(`/pedidos/${id.toLowerCase()}/pagar-cartao`, {
      metodo: 'POST',
      corpo: dados,
      token,
      canal: 'site',
      ipCliente: ipDoVisitante(req.headers),
      userAgent: req.headers.get('user-agent') ?? undefined,
      tempoLimiteMs: TEMPO_LIMITE_PAGAMENTO_MS,
    });
    const resultado = resultadoCartao(bruto);
    if (chave && contaComoRecusa(resultado)) tentativas.registrarFalha(chave, Date.now());
    if (chave && resultado.status === 'pago') tentativas.limpar(chave);
    return respostaJson(resultado);
  }, { mudaEstado: true });
}
