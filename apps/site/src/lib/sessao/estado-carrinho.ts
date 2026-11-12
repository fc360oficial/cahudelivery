import type { Carrinho } from '@/lib/api/tipos';

const ERRO_SERVIDOR = 'O servidor não respondeu direito. Tente novamente.';
const ERRO_PADRAO = 'Não foi possível atualizar o carrinho.';

/** Uma leitura (GET) só vale se nenhuma mutação (PUT) terminou depois que ela começou. */
export function deveAplicarLeitura(sequenciaNoInicio: number, sequenciaAtual: number): boolean {
  return sequenciaNoInicio === sequenciaAtual;
}

/** Interpreta a resposta de uma mutação sem confiar que o corpo seja JSON. */
export function interpretarRespostaMutacao(ok: boolean, texto: string): { carrinho: Carrinho } | { erro: string } {
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return { erro: ERRO_SERVIDOR };
  }
  if (ok) return { carrinho: corpo as Carrinho };
  const mensagem = (corpo as { mensagem?: unknown } | null)?.mensagem;
  return { erro: typeof mensagem === 'string' && mensagem ? mensagem : ERRO_PADRAO };
}
