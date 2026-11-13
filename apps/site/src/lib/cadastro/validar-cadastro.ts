import { apenasDigitos, documentoValido, type TipoDocumento } from './documento';

/**
 * Validação do cadastro de cliente novo, igual no navegador e no servidor do site. Segue as regras
 * da tela de cadastro do app (cadastro_screen.dart) e da API (RegistrarDto, resolverInscricaoEstadual,
 * senhaFraca); o site só acrescenta o dígito verificador do documento e tamanhos máximos. Quem decide
 * no fim é a API. Devolve só os campos que o RegistrarDto aceita.
 */

/** Categorias de estabelecimento: as mesmas do app (categoriasEstabelecimento). */
export const CATEGORIAS = [
  'Açougue e Frigorífico',
  'Atacarejo e Supermercado',
  'Restaurante',
  'Bar e Petiscos',
  'Padaria e Confeitaria',
  'Cafeteria',
  'Mercearia e Conveniência',
  'Distribuidor',
  'Outro',
] as const;

/** Campo invisível (honeypot): gente não vê nem preenche; robô que preenche tudo cai nele. */
export const CAMPO_ARMADILHA = 'paginaWeb';

export const MINIMO_SENHA = 6;
export const MAXIMO_SENHA = 200;
export const REGRA_SENHA = 'Mínimo de 6 caracteres. Não use sequências como 123456 nem o próprio CNPJ/CPF.';
const MENSAGEM_SENHA_FRACA = 'Essa senha é fácil de adivinhar. Escolha outra.';

export interface EnderecoCadastro {
  cep: string;
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  codigoMunicipio?: string;
}

/** Espelho do RegistrarDto da API (apps/api/src/auth/auth.controller.ts). */
export interface DadosCadastro {
  tipo: TipoDocumento;
  documento: string;
  nomeFantasia: string;
  razaoSocial?: string;
  email?: string;
  telefone: string;
  endereco: EnderecoCadastro;
  categoria?: string;
  inscricaoEstadual?: string;
  isentoIe?: boolean;
  senha: string;
  codigoIndicacao?: string;
}

/** Na ordem em que aparecem no formulário (o foco vai para o primeiro com erro). */
export const CAMPOS_EM_ORDEM = [
  'tipo', 'documento', 'nomeFantasia', 'razaoSocial', 'inscricaoEstadual', 'email', 'telefone', 'categoria',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf',
  'senha', 'confirmacao', 'codigoIndicacao',
] as const;

export type CampoCadastro = (typeof CAMPOS_EM_ORDEM)[number];
export type ErrosCadastro = Partial<Record<CampoCadastro, string>>;

export type ResultadoCadastro = { ok: true; dados: DadosCadastro } | { ok: false; erros: ErrosCadastro };

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const OBRIGATORIO = 'Campo obrigatório';
const maximo = (n: number) => `Use no máximo ${n} caracteres`;

const objeto = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Texto aparado. `undefined` = ausente/vazio; `null` = tipo errado; string = valor. */
function aparar(v: unknown): string | undefined | null {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : undefined;
}

/** Mesma regra da API (apps/api/src/auth/senha-provisoria.ts): sequências óbvias e o próprio documento. */
export function senhaFraca(senha: string, documento: string): boolean {
  return ['123456', '654321', '123123', '111111', '000000'].includes(senha) || senha === documento;
}

/** O campo invisível veio preenchido? Então é robô: responder como sucesso sem chamar a API. */
export function caiuNaArmadilha(corpo: unknown): boolean {
  const v = objeto(corpo)?.[CAMPO_ARMADILHA];
  if (v === undefined || v === null) return false;
  return typeof v !== 'string' || v.trim() !== '';
}

export function validarCadastro(corpo: unknown): ResultadoCadastro {
  const o = objeto(corpo);
  if (!o) return { ok: false, erros: {} };
  const erros: ErrosCadastro = {};

  const obrigatorio = (campo: CampoCadastro, v: unknown, max: number): string => {
    const t = aparar(v);
    if (typeof t !== 'string') erros[campo] = OBRIGATORIO;
    else if (t.length > max) erros[campo] = maximo(max);
    return typeof t === 'string' ? t : '';
  };
  const opcional = (campo: CampoCadastro, v: unknown, max: number): string | undefined => {
    const t = aparar(v);
    if (t === null) erros[campo] = 'Valor inválido';
    else if (t !== undefined && t.length > max) erros[campo] = maximo(max);
    return typeof t === 'string' ? t : undefined;
  };

  const tipo: TipoDocumento | null = o.tipo === 'CNPJ' || o.tipo === 'CPF' ? o.tipo : null;
  if (!tipo) erros.tipo = 'Escolha CNPJ ou CPF';
  const ehCnpj = tipo !== 'CPF';

  const documentoBruto = typeof o.documento === 'string' && o.documento.length <= 40 ? o.documento : '';
  const documento = apenasDigitos(documentoBruto);
  if (!documentoValido(ehCnpj ? 'CNPJ' : 'CPF', documento)) erros.documento = `${ehCnpj ? 'CNPJ' : 'CPF'} inválido`;

  const nomeFantasia = obrigatorio('nomeFantasia', o.nomeFantasia, 120);
  const razaoSocial = ehCnpj ? opcional('razaoSocial', o.razaoSocial, 150) : undefined;

  let inscricaoEstadual: string | undefined;
  let isentoIe: boolean | undefined;
  if (ehCnpj) {
    if (o.isentoIe !== undefined && typeof o.isentoIe !== 'boolean') {
      erros.inscricaoEstadual = 'Informe a IE ou marque Isento';
    } else if (o.isentoIe === true) {
      isentoIe = true;
    } else {
      const bruto = o.inscricaoEstadual;
      const ie = bruto === undefined || bruto === null ? ''
        : typeof bruto === 'string' && bruto.length <= 30 ? apenasDigitos(bruto) : null;
      if (ie === null) erros.inscricaoEstadual = 'Inscrição Estadual inválida';
      else if (!ie) erros.inscricaoEstadual = 'Informe a IE ou marque Isento';
      else if (ie.length < 8 || ie.length > 14) erros.inscricaoEstadual = 'Inscrição Estadual inválida';
      else inscricaoEstadual = ie;
    }
  }

  const email = aparar(o.email);
  if (email === null || (email !== undefined && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) {
    erros.email = 'E-mail inválido';
  }

  const telefoneBruto = typeof o.telefone === 'string' && o.telefone.length <= 30 ? o.telefone : '';
  const telefone = apenasDigitos(telefoneBruto);
  if (telefone.length < 10 || telefone.length > 11) erros.telefone = 'Informe o telefone com DDD';

  const categoria = aparar(o.categoria);
  if (categoria === null || (categoria !== undefined && !(CATEGORIAS as readonly string[]).includes(categoria))) {
    erros.categoria = 'Categoria inválida';
  }

  const e = objeto(o.endereco) ?? {};
  const cepBruto = typeof e.cep === 'string' ? e.cep.trim() : '';
  const cep = /^\d{5}-?\d{3}$/.test(cepBruto) ? apenasDigitos(cepBruto) : '';
  if (!cep) erros.cep = 'CEP inválido';
  const logradouro = obrigatorio('logradouro', e.logradouro, 120);
  const numero = obrigatorio('numero', e.numero, 20);
  const complemento = opcional('complemento', e.complemento, 80);
  const bairro = obrigatorio('bairro', e.bairro, 80);
  const cidade = obrigatorio('cidade', e.cidade, 80);
  const uf = typeof e.uf === 'string' ? e.uf.trim().toUpperCase() : '';
  if (!UFS.has(uf)) erros.uf = 'UF inválida';
  // Código IBGE vem da busca de CEP, o cliente não digita: fora do formato é só descartado.
  const codigoMunicipio = typeof e.codigoMunicipio === 'string' && /^\d{7}$/.test(e.codigoMunicipio) ? e.codigoMunicipio : undefined;

  // Senha não é aparada (como no app e na API).
  const senha = typeof o.senha === 'string' ? o.senha : '';
  if (senha.length < MINIMO_SENHA) erros.senha = 'Mínimo de 6 caracteres';
  else if (senha.length > MAXIMO_SENHA) erros.senha = maximo(MAXIMO_SENHA);
  else if (senhaFraca(senha, documento)) erros.senha = MENSAGEM_SENHA_FRACA;

  const codigo = aparar(o.codigoIndicacao);
  if (codigo === null || (codigo !== undefined && !/^[A-Za-z0-9]{1,20}$/.test(codigo))) {
    erros.codigoIndicacao = 'Código de indicação inválido';
  }

  if (Object.keys(erros).length > 0 || !tipo) return { ok: false, erros };

  const endereco: EnderecoCadastro = { cep, logradouro, numero, bairro, cidade, uf };
  if (complemento) endereco.complemento = complemento;
  if (codigoMunicipio) endereco.codigoMunicipio = codigoMunicipio;

  const dados: DadosCadastro = { tipo, documento, nomeFantasia, telefone, endereco, senha };
  if (razaoSocial) dados.razaoSocial = razaoSocial;
  if (email) dados.email = email;
  if (categoria) dados.categoria = categoria;
  if (inscricaoEstadual) dados.inscricaoEstadual = inscricaoEstadual;
  if (isentoIe) dados.isentoIe = true;
  if (codigo) dados.codigoIndicacao = codigo.toUpperCase();
  return { ok: true, dados };
}
