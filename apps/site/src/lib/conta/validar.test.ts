import { describe, expect, it } from 'vitest';
import { validarCep, validarEndereco, validarPagina, validarPerfil, validarTrocaSenha } from './validar';

describe('validarPerfil', () => {
  it('nome fantasia aparado e telefone só com dígitos', () => {
    expect(validarPerfil({ nomeFantasia: '  Mercearia Boa  ', telefone: '(81) 99999-0000' }))
      .toEqual({ nomeFantasia: 'Mercearia Boa', telefone: '81999990000' });
    expect(validarPerfil({ nomeFantasia: 'AB', telefone: '8133334444' })).not.toBeNull();
  });
  it('recusa nome curto/longo, telefone fora de 10–11 dígitos e campos estranhos ao tipo', () => {
    expect(validarPerfil({ nomeFantasia: ' A ', telefone: '81999990000' })).toBeNull();
    expect(validarPerfil({ nomeFantasia: 'a'.repeat(121), telefone: '81999990000' })).toBeNull();
    expect(validarPerfil({ nomeFantasia: 'Loja', telefone: '999' })).toBeNull();
    expect(validarPerfil({ nomeFantasia: 'Loja', telefone: '819999900001' })).toBeNull();
    expect(validarPerfil({ nomeFantasia: 'Loja', telefone: '8'.repeat(40) })).toBeNull();
    expect(validarPerfil({ nomeFantasia: 123, telefone: '81999990000' })).toBeNull();
    expect(validarPerfil(null)).toBeNull();
    expect(validarPerfil([])).toBeNull();
  });
  it('só devolve os campos que a API aceita', () => {
    const r = validarPerfil({ nomeFantasia: 'Loja', telefone: '81999990000', email: 'x@y.z', status: 'aprovado' });
    expect(r).toEqual({ nomeFantasia: 'Loja', telefone: '81999990000' });
  });
});

describe('validarEndereco', () => {
  const ok = {
    apelido: 'Loja centro', cep: '50000-000', logradouro: 'Rua A', numero: '10', complemento: 'Sala 2',
    bairro: 'Centro', cidade: 'Recife', uf: 'pe', padrao: true,
  };
  it('normaliza CEP, UF e textos', () => {
    expect(validarEndereco(ok)).toEqual({
      apelido: 'Loja centro', cep: '50000000', logradouro: 'Rua A', numero: '10', complemento: 'Sala 2',
      bairro: 'Centro', cidade: 'Recife', uf: 'PE', padrao: true,
    });
  });
  it('opcionais vazios viram nulo e padrão falso', () => {
    const r = validarEndereco({ ...ok, apelido: '  ', complemento: '', padrao: undefined });
    expect(r).toMatchObject({ apelido: null, complemento: null, padrao: false });
  });
  it('recusa CEP sem 8 dígitos, UF inválida e obrigatórios vazios ou longos demais', () => {
    expect(validarEndereco({ ...ok, cep: '5000000' })).toBeNull();
    expect(validarEndereco({ ...ok, cep: '500000000' })).toBeNull();
    expect(validarEndereco({ ...ok, uf: 'P' })).toBeNull();
    expect(validarEndereco({ ...ok, uf: 'XX' })).toBeNull();
    expect(validarEndereco({ ...ok, logradouro: ' ' })).toBeNull();
    expect(validarEndereco({ ...ok, numero: '' })).toBeNull();
    expect(validarEndereco({ ...ok, bairro: 'b'.repeat(81) })).toBeNull();
    expect(validarEndereco({ ...ok, cidade: undefined })).toBeNull();
    expect(validarEndereco({ ...ok, complemento: 'c'.repeat(81) })).toBeNull();
    expect(validarEndereco({ ...ok, padrao: 'sim' })).toBeNull();
    expect(validarEndereco('texto')).toBeNull();
  });
});

describe('validarTrocaSenha', () => {
  it('senha atual de 1 a 200 e nova de 6 a 200, sem mexer no texto', () => {
    expect(validarTrocaSenha({ senhaAtual: ' x ', novaSenha: 'nova-123' })).toEqual({ senhaAtual: ' x ', novaSenha: 'nova-123' });
    expect(validarTrocaSenha({ senhaAtual: '', novaSenha: 'nova-123' })).toBeNull();
    expect(validarTrocaSenha({ senhaAtual: 'x', novaSenha: '12345' })).toBeNull();
    expect(validarTrocaSenha({ senhaAtual: 'x', novaSenha: 'a'.repeat(201) })).toBeNull();
    expect(validarTrocaSenha({ senhaAtual: 'a'.repeat(201), novaSenha: 'nova-123' })).toBeNull();
    expect(validarTrocaSenha({ senhaAtual: 1, novaSenha: 'nova-123' })).toBeNull();
    expect(validarTrocaSenha(null)).toBeNull();
  });
  it('nova igual à atual não vale', () => {
    expect(validarTrocaSenha({ senhaAtual: 'mesma-1', novaSenha: 'mesma-1' })).toBeNull();
  });
});

describe('validarCep', () => {
  it('8 dígitos, com ou sem hífen', () => {
    expect(validarCep('50000-000')).toBe('50000000');
    expect(validarCep('50000000')).toBe('50000000');
    expect(validarCep('5000000')).toBeNull();
    expect(validarCep('50000-0000')).toBeNull();
    expect(validarCep('abcdefgh')).toBeNull();
    expect(validarCep(null)).toBeNull();
  });
});

describe('validarPagina', () => {
  it('inteiro de 1 a 500; o resto vira 1', () => {
    expect(validarPagina('3')).toBe(3);
    expect(validarPagina(null)).toBe(1);
    expect(validarPagina('0')).toBe(1);
    expect(validarPagina('-2')).toBe(1);
    expect(validarPagina('2.5')).toBe(1);
    expect(validarPagina('abc')).toBe(1);
    expect(validarPagina('501')).toBe(1);
  });
});
