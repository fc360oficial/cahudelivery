export interface DadosLogin {
  identificador: string;
  senha: string;
}

export interface DadosPrimeiroAcesso {
  identificador: string;
  codigo: string;
  novaSenha: string;
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** CNPJ (14) ou CPF (11), só dígitos. Nulo se não for. */
function documento(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const digitos = v.replace(/\D/g, '');
  return digitos.length === 11 || digitos.length === 14 ? digitos : null;
}

const textoEntre = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

/** Corpo do login vindo do navegador. Nulo = inválido (não chamar a API). */
export function validarLogin(corpo: unknown): DadosLogin | null {
  const o = objeto(corpo);
  if (!o) return null;
  const identificador = documento(o.identificador);
  if (!identificador || !textoEntre(o.senha, 1, 200)) return null;
  return { identificador, senha: o.senha };
}

/** Para onde ir depois de entrar: só caminho interno (começa com "/" e não com "//" nem "/\"). */
export function destinoInterno(voltar: string | null): string {
  if (!voltar || !voltar.startsWith('/') || voltar.startsWith('//') || voltar.startsWith('/\\')) return '/';
  return voltar;
}

const CODIGOS_DA_TELA =['PRIMEIRO_ACESSO_PENDENTE', 'CODIGO_INVALIDO'];
const MENSAGEM_GENERICA = 'Não foi possível entrar agora. Tente novamente.';

/**
 * Erro da API de auth → resposta ao navegador. Só 400/401/429 levam a mensagem da API
 * (são as escritas para o cliente); o resto vira mensagem genérica. Nunca o corpo bruto.
 */
export function erroDeAutenticacao(
  status: number,
  mensagem: string,
  codigo?: string,
): { status: number; corpo: { mensagem: string; codigo?: string } } {
  if (status === 400 || status === 401 || status === 429) {
    const corpo: { mensagem: string; codigo?: string } = { mensagem };
    if (codigo && CODIGOS_DA_TELA.includes(codigo)) corpo.codigo = codigo;
    return { status, corpo };
  }
  return { status: status === 503 ? 503 : 500, corpo: { mensagem: MENSAGEM_GENERICA } };
}

/** Corpo do primeiro acesso / esqueci a senha. Nulo = inválido (não chamar a API). */
export function validarPrimeiroAcesso(corpo: unknown): DadosPrimeiroAcesso | null {
  const o = objeto(corpo);
  if (!o) return null;
  const identificador = documento(o.identificador);
  if (!identificador) return null;
  if (!textoEntre(o.codigo, 4, 12) || /\s/.test(o.codigo)) return null;
  if (!textoEntre(o.novaSenha, 6, 200)) return null;
  return { identificador, codigo: o.codigo, novaSenha: o.novaSenha };
}
