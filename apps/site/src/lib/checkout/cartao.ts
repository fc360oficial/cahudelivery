/**
 * Pagamento com cartão pelo site. Os dados do cartão só passam pelo servidor do site em memória,
 * na mesma requisição, direto para a API: nada aqui grava, loga ou devolve número/CVV.
 */

/** O que a API pede para o 3DS (DispositivoDto). O IP e o User-Agent vão por cabeçalho. */
export interface Dispositivo {
  altura: number;
  largura: number;
  profundidadeCor?: number;
  idioma?: string;
  fusoHoras: number;
}

export interface DadosPagamentoCartao {
  numero: string;
  nome: string;
  validadeMes: number;
  validadeAno: number;
  cvv: string;
  dispositivo: Dispositivo;
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const inteiroEntre = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Dígito verificador (Luhn): pega erro de digitação antes de gastar uma tentativa no banco. */
export function luhnOk(digitos: string): boolean {
  let soma = 0;
  let dobra = false;
  for (let i = digitos.length - 1; i >= 0; i--) {
    let d = digitos.charCodeAt(i) - 48;
    if (dobra) { d *= 2; if (d > 9) d -= 9; }
    soma += d;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

function dispositivo(v: unknown): Dispositivo | null {
  const o = objeto(v);
  if (!o) return null;
  if (!inteiroEntre(o.altura, 1, 100_000) || !inteiroEntre(o.largura, 1, 100_000) || !inteiroEntre(o.fusoHoras, -14, 14)) return null;
  const d: Dispositivo = { altura: o.altura, largura: o.largura, fusoHoras: o.fusoHoras };
  if (o.profundidadeCor !== undefined) {
    if (!inteiroEntre(o.profundidadeCor, 1, 48)) return null;
    d.profundidadeCor = o.profundidadeCor;
  }
  if (o.idioma !== undefined) {
    if (typeof o.idioma !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,6})?$/.test(o.idioma)) return null;
    d.idioma = o.idioma;
  }
  return d;
}

/** Validação no servidor. Nulo = inválido (não chamar a API). `agora` decide se a validade venceu. */
export function validarPagamentoCartao(corpo: unknown, agora: Date): DadosPagamentoCartao | null {
  const o = objeto(corpo);
  if (!o) return null;
  if (typeof o.numero !== 'string' || o.numero.length > 40 || !/^[\d ]+$/.test(o.numero)) return null;
  const numero = o.numero.replace(/ /g, '');
  if (numero.length < 13 || numero.length > 19 || !luhnOk(numero)) return null;
  if (typeof o.nome !== 'string' || o.nome.length > 60) return null;
  const nome = o.nome.trim();
  if (nome.length < 2 || nome.length > 30) return null;
  const anoAtual = agora.getFullYear();
  if (!inteiroEntre(o.validadeMes, 1, 12) || !inteiroEntre(o.validadeAno, anoAtual, anoAtual + 20)) return null;
  // Vale até o último dia do mês impresso.
  if (o.validadeAno * 12 + o.validadeMes < anoAtual * 12 + (agora.getMonth() + 1)) return null;
  if (typeof o.cvv !== 'string' || !/^\d{3,4}$/.test(o.cvv)) return null;
  const d = dispositivo(o.dispositivo);
  if (!d) return null;
  return { numero, nome, validadeMes: o.validadeMes, validadeAno: o.validadeAno, cvv: o.cvv, dispositivo: d };
}

/** Campo "MM/AA" do formulário → mês e ano com 4 dígitos. */
export function lerValidade(texto: string): { mes: number; ano: number } | null {
  const m = /^(\d{2})\/?(\d{2})$/.exec(texto.trim());
  if (!m) return null;
  const mes = Number(m[1]);
  return mes >= 1 && mes <= 12 ? { mes, ano: 2000 + Number(m[2]) } : null;
}

/** URL do desafio 3DS: só https absoluta e sem credenciais; o resto não é seguido. */
export function urlDesafioSegura(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

export type ResultadoCartao =
  | { status: 'pago' }
  | { status: 'recusado'; mensagem: string }
  | { status: 'autenticar'; urlAutenticacao: string }
  | { status: 'indefinido' };

/** Resposta do POST pedidos/:id/pagar-cartao → o que a tela precisa (sem código do emissor etc.). */
export function resultadoCartao(b: unknown): ResultadoCartao {
  const o = objeto(b);
  if (o?.status === 'pago') return { status: 'pago' };
  if (o?.status === 'recusado') {
    const mensagem = typeof o.mensagem === 'string' && o.mensagem.trim() ? o.mensagem.trim().slice(0, 300) : 'Pagamento recusado. Tente outro cartão.';
    return { status: 'recusado', mensagem };
  }
  if (o?.status === 'autenticar') {
    const url = urlDesafioSegura(o.urlAutenticacao);
    if (url) return { status: 'autenticar', urlAutenticacao: url };
  }
  return { status: 'indefinido' };
}

/** `?pagamento=` da volta do banco: só uma dica para iniciar a conferência, nunca prova de nada. */
export function retornoDoBanco(v: string | null): 'ok' | 'falhou' | null {
  return v === 'ok' || v === 'falhou' ? v : null;
}
