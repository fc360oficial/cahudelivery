export const MENSAGEM_GENERICA_CADASTRO = 'Não foi possível concluir o cadastro agora. Tente novamente.';

/** Códigos da API que a tela usa para oferecer "Entrar" / "Primeiro acesso" (os mesmos que o app trata). */
const CODIGOS_DA_TELA = ['CLIENTE_JA_EXISTE', 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO'];
const COM_MENSAGEM = [400, 401, 409, 422, 429];

/**
 * Erro do POST auth/registrar → resposta ao navegador. Só 400/401/409/422/429 levam a mensagem da
 * API (são as escritas para o cliente); o resto vira mensagem genérica. Nunca o corpo bruto.
 */
export function erroDoCadastro(
  status: number,
  mensagem: string,
  codigo?: string,
): { status: number; corpo: { mensagem: string; codigo?: string } } {
  if (COM_MENSAGEM.includes(status)) {
    const corpo: { mensagem: string; codigo?: string } = { mensagem };
    if (codigo && CODIGOS_DA_TELA.includes(codigo)) corpo.codigo = codigo;
    return { status, corpo };
  }
  return { status: status === 503 ? 503 : 500, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } };
}
