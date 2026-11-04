import { createHash, randomInt } from 'node:crypto';

export const CODIGO_VALIDADE_DIAS = 7;
export const CODIGO_MAX_TENTATIVAS = 5;

// Sem 0/O/1/I: o código é passado por telefone e WhatsApp.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 8 caracteres em dois blocos (ABCD-EFGH). */
export function gerarCodigoAcesso(): string {
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/** Aceita minúsculas, espaços e com ou sem o traço. */
export function normalizarCodigo(codigo: string): string {
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashCodigoAcesso(clienteId: string, codigo: string): string {
  return createHash('sha256').update(`${clienteId}:${normalizarCodigo(codigo)}`).digest('hex');
}
