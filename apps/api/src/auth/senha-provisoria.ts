import * as argon2 from 'argon2';

export const SENHA_PROVISORIA = '123456';

export const hashSenhaProvisoria = () => argon2.hash(SENHA_PROVISORIA);
