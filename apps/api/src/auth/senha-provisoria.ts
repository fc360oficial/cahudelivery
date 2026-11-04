import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

/**
 * Conta criada sem senha (cliente vindo do ERP): o hash é de um valor aleatório
 * que ninguém conhece. O cliente só entra depois de criar a senha com o código
 * de acesso gerado na retaguarda.
 */
export const hashSenhaProvisoria = () => argon2.hash(randomBytes(32).toString('hex'));

/** Recusa a antiga senha padrão, sequências óbvias e o próprio documento. */
export function senhaFraca(senha: string, documento: string): boolean {
  return ['123456', '654321', '123123', '111111', '000000'].includes(senha) || senha === documento;
}
