import { describe, expect, it } from 'vitest';
import { destinoInterno, erroDeAutenticacao, validarLogin, validarPrimeiroAcesso } from './credenciais';

describe('destinoInterno', () => {
  it('aceita caminho interno', () => {
    expect(destinoInterno('/carrinho')).toBe('/carrinho');
    expect(destinoInterno('/c/bebidas-1?ordem=preco_asc')).toBe('/c/bebidas-1?ordem=preco_asc');
  });
  it('o resto vai para a página inicial', () => {
    expect(destinoInterno(null)).toBe('/');
    expect(destinoInterno('')).toBe('/');
    expect(destinoInterno('https://outro.com')).toBe('/');
    expect(destinoInterno('//outro.com')).toBe('/');
    expect(destinoInterno('/\\outro.com')).toBe('/');
    expect(destinoInterno('carrinho')).toBe('/');
    expect(destinoInterno('javascript:alert(1)')).toBe('/');
    expect(destinoInterno(undefined)).toBe('/');
  });
  it('rejeita TAB/LF/CR e barra invertida, que o navegador remove ou converte', () => {
    for (const v of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\\evil.com', '/\t\\evil.com', '/a\u0000b', '/a\u007fb']) {
      expect(destinoInterno(v), JSON.stringify(v)).toBe('/');
    }
  });
  it('mantém caminho, busca e âncora válidos', () => {
    expect(destinoInterno('/c/x-1?ordem=preco_asc#topo')).toBe('/c/x-1?ordem=preco_asc#topo');
  });
});

describe('erroDeAutenticacao', () => {
  it('400, 401 e 429 usam a mensagem da API', () => {
    expect(erroDeAutenticacao(401, 'CNPJ/CPF ou senha inválidos')).toEqual({ status: 401, corpo: { mensagem: 'CNPJ/CPF ou senha inválidos' } });
    expect(erroDeAutenticacao(429, 'Muitas tentativas.', 'MUITAS_TENTATIVAS')).toEqual({ status: 429, corpo: { mensagem: 'Muitas tentativas.' } });
    expect(erroDeAutenticacao(400, 'Senha fraca')).toEqual({ status: 400, corpo: { mensagem: 'Senha fraca' } });
  });

  it('repassa só os códigos que a tela usa', () => {
    expect(erroDeAutenticacao(401, 'Crie a senha', 'PRIMEIRO_ACESSO_PENDENTE').corpo)
      .toEqual({ mensagem: 'Crie a senha', codigo: 'PRIMEIRO_ACESSO_PENDENTE' });
    expect(erroDeAutenticacao(400, 'Código inválido', 'CODIGO_INVALIDO').corpo)
      .toEqual({ mensagem: 'Código inválido', codigo: 'CODIGO_INVALIDO' });
  });

  it('o resto vira mensagem genérica, sem o texto da API', () => {
    expect(erroDeAutenticacao(500, 'stack trace interno')).toEqual({ status: 500, corpo: { mensagem: 'Não foi possível entrar agora. Tente novamente.' } });
    expect(erroDeAutenticacao(503, 'x').status).toBe(503);
    expect(erroDeAutenticacao(404, 'Cannot POST /v1/auth/login').corpo.mensagem).toBe('Não foi possível entrar agora. Tente novamente.');
    expect(erroDeAutenticacao(404, 'x').status).toBe(500);
  });
});

describe('validarLogin', () => {
  it('deixa o identificador só com dígitos (CPF 11 ou CNPJ 14)', () => {
    expect(validarLogin({ identificador: '529.982.247-25', senha: 'abc' })).toEqual({ identificador: '52998224725', senha: 'abc' });
    expect(validarLogin({ identificador: '11.222.333/0001-81', senha: 'x' })).toEqual({ identificador: '11222333000181', senha: 'x' });
  });

  it('senha de 1 a 200 caracteres, sem mexer nela', () => {
    expect(validarLogin({ identificador: '52998224725', senha: ' a ' })?.senha).toBe(' a ');
    expect(validarLogin({ identificador: '52998224725', senha: 'a'.repeat(200) })).not.toBeNull();
    expect(validarLogin({ identificador: '52998224725', senha: 'a'.repeat(201) })).toBeNull();
    expect(validarLogin({ identificador: '52998224725', senha: '' })).toBeNull();
  });

  it('recusa o resto', () => {
    expect(validarLogin(null)).toBeNull();
    expect(validarLogin('texto')).toBeNull();
    expect(validarLogin([])).toBeNull();
    expect(validarLogin({ identificador: '123', senha: 'x' })).toBeNull();
    expect(validarLogin({ identificador: '123456789012', senha: 'x' })).toBeNull();
    expect(validarLogin({ identificador: 52998224725, senha: 'x' })).toBeNull();
    expect(validarLogin({ identificador: '52998224725', senha: 123 })).toBeNull();
    expect(validarLogin({ identificador: '52998224725' })).toBeNull();
    expect(validarLogin({ identificador: '1'.repeat(500), senha: 'x' })).toBeNull();
  });
});

describe('validarPrimeiroAcesso', () => {
  const ok = { identificador: '529.982.247-25', codigo: 'AB12CD', novaSenha: 'segredo' };

  it('aceita e devolve o identificador só com dígitos', () => {
    expect(validarPrimeiroAcesso(ok)).toEqual({ identificador: '52998224725', codigo: 'AB12CD', novaSenha: 'segredo' });
  });

  it('código de 4 a 12 caracteres sem espaços', () => {
    expect(validarPrimeiroAcesso({ ...ok, codigo: '1234' })).not.toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, codigo: '1'.repeat(12) })).not.toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, codigo: '123' })).toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, codigo: '1'.repeat(13) })).toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, codigo: 'AB 12' })).toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, codigo: 1234 })).toBeNull();
  });

  it('nova senha de 6 a 200 caracteres', () => {
    expect(validarPrimeiroAcesso({ ...ok, novaSenha: '12345' })).toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, novaSenha: 'a'.repeat(200) })).not.toBeNull();
    expect(validarPrimeiroAcesso({ ...ok, novaSenha: 'a'.repeat(201) })).toBeNull();
  });

  it('recusa identificador inválido e corpo que não é objeto', () => {
    expect(validarPrimeiroAcesso({ ...ok, identificador: '12' })).toBeNull();
    expect(validarPrimeiroAcesso(null)).toBeNull();
  });
});
