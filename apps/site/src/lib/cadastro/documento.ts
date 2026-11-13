/** Documento, telefone e CEP do cadastro: validação de dígito verificador e máscaras de digitação. */

export type TipoDocumento = 'CNPJ' | 'CPF';

export const apenasDigitos = (v: string): string => v.replace(/\D/g, '');

const repetido = (d: string) => /^(\d)\1+$/.test(d);

/** Dígito verificador no módulo 11 com os pesos dados (resto < 2 vira 0). */
function digito(numeros: string, pesos: number[]): number {
  const soma = pesos.reduce((t, peso, i) => t + Number(numeros[i]) * peso, 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfValido(v: string): boolean {
  const d = apenasDigitos(v);
  if (d.length !== 11 || repetido(d)) return false;
  const d1 = digito(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

export function cnpjValido(v: string): boolean {
  const d = apenasDigitos(v);
  if (d.length !== 14 || repetido(d)) return false;
  const d1 = digito(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export const documentoValido = (tipo: TipoDocumento, v: string): boolean =>
  tipo === 'CNPJ' ? cnpjValido(v) : cpfValido(v);

/** Aplica um molde ("00.000.000/0000-00") aos dígitos digitados até onde eles forem. */
function moldar(digitos: string, molde: string): string {
  let saida = '';
  let i = 0;
  for (const c of molde) {
    if (i >= digitos.length) break;
    if (c === '0') saida += digitos[i++];
    else saida += c;
  }
  return saida;
}

export function mascararDocumento(tipo: TipoDocumento, v: string): string {
  const d = apenasDigitos(v);
  return tipo === 'CNPJ' ? moldar(d.slice(0, 14), '00.000.000/0000-00') : moldar(d.slice(0, 11), '000.000.000-00');
}

/** "(81) 3333-4444" (fixo, 10 dígitos) ou "(81) 99999-0000" (celular, 11). */
export function mascararTelefone(v: string): string {
  const d = apenasDigitos(v).slice(0, 11);
  if (!d) return '';
  return moldar(d, d.length === 11 ? '(00) 00000-0000' : '(00) 0000-0000');
}

export function mascararCep(v: string): string {
  return moldar(apenasDigitos(v).slice(0, 8), '00000-000');
}
