import { describe, expect, it } from 'vitest';
import { dispositivoValido, requisicaoSegura } from './requisicao';

const h = (proto?: string) => new Headers(proto === undefined ? {} : { 'x-forwarded-proto': proto });

describe('requisicaoSegura', () => {
  it('https vindo do proxy', () => {
    expect(requisicaoSegura(h('https'), 'http://localhost:3010/api/carrinho/itens')).toBe(true);
  });
  it('http puro, sem cabeçalho do proxy', () => {
    expect(requisicaoSegura(h(), 'http://192.168.0.10:3010/api/carrinho/itens')).toBe(false);
  });
  it('sem cabeçalho e com url https', () => {
    expect(requisicaoSegura(h(), 'https://loja.exemplo.com.br/api/carrinho/itens')).toBe(true);
  });
  it('lista separada por vírgula usa o primeiro valor', () => {
    expect(requisicaoSegura(h('https, http'), 'http://x/')).toBe(true);
    expect(requisicaoSegura(h('http, https'), 'https://x/')).toBe(false);
  });
  it('cabeçalho http prevalece sobre a url', () => {
    expect(requisicaoSegura(h('http'), 'https://x/')).toBe(false);
  });
  it('url inválida sem cabeçalho não é segura', () => {
    expect(requisicaoSegura(h(), 'isto não é url')).toBe(false);
  });
});

describe('dispositivoValido', () => {
  it('aceita só UUID inteiro', () => {
    expect(dispositivoValido('9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295')).toBe('9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295');
    expect(dispositivoValido('lixo')).toBeNull();
    expect(dispositivoValido('x9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295')).toBeNull();
    expect(dispositivoValido('')).toBeNull();
    expect(dispositivoValido(undefined)).toBeNull();
  });
});
