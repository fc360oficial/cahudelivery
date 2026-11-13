import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, documentoValido, mascararCep, mascararDocumento, mascararTelefone } from './documento';

describe('cpfValido', () => {
  it('aceita CPF com dígitos verificadores certos, com ou sem pontuação', () => {
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('11144477735')).toBe(true);
  });
  it('recusa dígito verificador errado', () => {
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfValido('52998224715')).toBe(false);
  });
  it('recusa sequência repetida, tamanho errado e vazio', () => {
    for (const d of '0123456789') expect(cpfValido(d.repeat(11))).toBe(false);
    expect(cpfValido('5299822472')).toBe(false);
    expect(cpfValido('529982247250')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });
});

describe('cnpjValido', () => {
  it('aceita CNPJ com dígitos verificadores certos, com ou sem pontuação', () => {
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11444777000161')).toBe(true);
  });
  it('recusa dígito verificador errado', () => {
    expect(cnpjValido('11222333000182')).toBe(false);
    expect(cnpjValido('11222333000191')).toBe(false);
  });
  it('recusa sequência repetida, tamanho errado e vazio', () => {
    for (const d of '0123456789') expect(cnpjValido(d.repeat(14))).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('112223330001811')).toBe(false);
    expect(cnpjValido('')).toBe(false);
  });
});

describe('documentoValido', () => {
  it('confere pelo tipo escolhido', () => {
    expect(documentoValido('CNPJ', '11222333000181')).toBe(true);
    expect(documentoValido('CPF', '11222333000181')).toBe(false);
    expect(documentoValido('CPF', '52998224725')).toBe(true);
    expect(documentoValido('CNPJ', '52998224725')).toBe(false);
  });
});

describe('máscaras', () => {
  it('CNPJ vai pontuando enquanto digita e corta em 14 dígitos', () => {
    expect(mascararDocumento('CNPJ', '11')).toBe('11');
    expect(mascararDocumento('CNPJ', '11222')).toBe('11.222');
    expect(mascararDocumento('CNPJ', '11222333')).toBe('11.222.333');
    expect(mascararDocumento('CNPJ', '112223330001')).toBe('11.222.333/0001');
    expect(mascararDocumento('CNPJ', '11222333000181')).toBe('11.222.333/0001-81');
    expect(mascararDocumento('CNPJ', '11.222.333/0001-8199')).toBe('11.222.333/0001-81');
  });
  it('CPF vai pontuando enquanto digita e corta em 11 dígitos', () => {
    expect(mascararDocumento('CPF', '529')).toBe('529');
    expect(mascararDocumento('CPF', '5299822')).toBe('529.982.2');
    expect(mascararDocumento('CPF', '52998224725')).toBe('529.982.247-25');
    expect(mascararDocumento('CPF', '529982247259')).toBe('529.982.247-25');
  });
  it('telefone fixo e celular com DDD', () => {
    expect(mascararTelefone('81')).toBe('(81');
    expect(mascararTelefone('8133334')).toBe('(81) 3333-4');
    expect(mascararTelefone('8133334444')).toBe('(81) 3333-4444');
    expect(mascararTelefone('81999990000')).toBe('(81) 99999-0000');
    expect(mascararTelefone('819999900001')).toBe('(81) 99999-0000');
    expect(mascararTelefone('')).toBe('');
  });
  it('CEP com hífen depois do quinto dígito', () => {
    expect(mascararCep('5121')).toBe('5121');
    expect(mascararCep('512100')).toBe('51210-0');
    expect(mascararCep('51210050')).toBe('51210-050');
    expect(mascararCep('51210-0509')).toBe('51210-050');
  });
});
