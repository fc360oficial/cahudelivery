/** Validação no servidor dos corpos vindos do navegador. Nulo = inválido (não chamar a API). */

export interface DadosPerfil { nomeFantasia: string; telefone: string }

export interface DadosEndereco {
  apelido: string | null;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  padrao: boolean;
}

export interface DadosTrocaSenha { senhaAtual: string; novaSenha: string }

export const MENSAGEM_ENDERECO_INVALIDO =
  'Confira o endereço: CEP com 8 dígitos, UF com 2 letras e os campos obrigatórios preenchidos.';

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Texto obrigatório, aparado, entre min e max caracteres. */
function texto(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string' || v.length > max * 2) return null;
  const t = v.trim();
  return t.length >= min && t.length <= max ? t : null;
}

/** Texto opcional: ausente ou vazio = nulo (válido); inválido = undefined. */
function opcional(v: unknown, max: number): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || v.length > max * 2) return undefined;
  const t = v.trim();
  if (!t) return null;
  return t.length <= max ? t : undefined;
}

const textoEntre = (v: unknown, min: number, max: number): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

export function validarCep(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 9) return null;
  if (!/^\d{5}-?\d{3}$/.test(v.trim())) return null;
  return v.replace(/\D/g, '');
}

/** Só os campos que o PUT /perfil aceita (PerfilDto: nomeFantasia, telefone). */
export function validarPerfil(corpo: unknown): DadosPerfil | null {
  const o = objeto(corpo);
  if (!o) return null;
  const nomeFantasia = texto(o.nomeFantasia, 2, 120);
  if (!nomeFantasia || typeof o.telefone !== 'string' || o.telefone.length > 30) return null;
  const telefone = o.telefone.replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 11) return null;
  return { nomeFantasia, telefone };
}

/** Os campos do EnderecoDto da API, com os limites do site. */
export function validarEndereco(corpo: unknown): DadosEndereco | null {
  const o = objeto(corpo);
  if (!o) return null;
  const cep = validarCep(o.cep);
  const logradouro = texto(o.logradouro, 1, 120);
  const numero = texto(o.numero, 1, 20);
  const bairro = texto(o.bairro, 1, 80);
  const cidade = texto(o.cidade, 1, 80);
  const apelido = opcional(o.apelido, 40);
  const complemento = opcional(o.complemento, 80);
  const uf = typeof o.uf === 'string' ? o.uf.trim().toUpperCase() : '';
  if (o.padrao !== undefined && typeof o.padrao !== 'boolean') return null;
  if (!cep || !logradouro || !numero || !bairro || !cidade || apelido === undefined || complemento === undefined) return null;
  if (!UFS.has(uf)) return null;
  return { apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao: o.padrao === true };
}

/** POST auth/senha: senha atual + nova (6 a 200). Senhas não são aparadas. */
export function validarTrocaSenha(corpo: unknown): DadosTrocaSenha | null {
  const o = objeto(corpo);
  if (!o || !textoEntre(o.senhaAtual, 1, 200) || !textoEntre(o.novaSenha, 6, 200)) return null;
  if (o.senhaAtual === o.novaSenha) return null;
  return { senhaAtual: o.senhaAtual, novaSenha: o.novaSenha };
}

/** ?pagina= das listas: inteiro de 1 a 500; o resto vira 1. */
export function validarPagina(v: string | null): number {
  if (!v || !/^\d{1,3}$/.test(v)) return 1;
  const n = Number(v);
  return n >= 1 && n <= 500 ? n : 1;
}
