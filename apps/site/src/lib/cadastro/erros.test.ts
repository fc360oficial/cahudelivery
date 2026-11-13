import { describe, expect, it } from 'vitest';
import { erroDoCadastro, MENSAGEM_GENERICA_CADASTRO } from './erros';

describe('erroDoCadastro', () => {
  it('documento já cadastrado: repassa a mensagem e o código da API (o app faz o mesmo)', () => {
    expect(erroDoCadastro(409, 'Já existe cadastro para este CNPJ/CPF. Use Entrar.', 'CLIENTE_JA_EXISTE')).toEqual({
      status: 409, corpo: { mensagem: 'Já existe cadastro para este CNPJ/CPF. Use Entrar.', codigo: 'CLIENTE_JA_EXISTE' },
    });
    expect(erroDoCadastro(409, 'Você já é cliente CAHU. Peça à distribuidora o código de acesso para criar sua senha.', 'CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO').corpo.codigo)
      .toBe('CLIENTE_JA_EXISTE_PRIMEIRO_ACESSO');
  });

  it('400/401/422/429 levam a mensagem da API; código desconhecido não passa', () => {
    for (const status of [400, 401, 422, 429]) {
      expect(erroDoCadastro(status, 'Inscrição Estadual inválida', 'OUTRO')).toEqual({ status, corpo: { mensagem: 'Inscrição Estadual inválida' } });
    }
  });

  it('demais status viram mensagem genérica, sem nada da API', () => {
    expect(erroDoCadastro(500, 'select * from clientes falhou')).toEqual({ status: 500, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } });
    expect(erroDoCadastro(404, 'Cannot POST /v1/auth/registrar')).toEqual({ status: 500, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } });
    expect(erroDoCadastro(502, 'x')).toEqual({ status: 500, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } });
    expect(erroDoCadastro(504, 'demorou')).toEqual({ status: 500, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } });
    expect(erroDoCadastro(503, 'fora')).toEqual({ status: 503, corpo: { mensagem: MENSAGEM_GENERICA_CADASTRO } });
  });
});
