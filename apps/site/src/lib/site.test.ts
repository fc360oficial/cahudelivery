import { afterEach, describe, expect, it } from 'vitest';
import { indexavel, linkWhatsapp, siteUrl } from './site';

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.SITE_INDEXAVEL;
});

describe('site', () => {
  it('siteUrl sem barra no fim, com padrão local', () => {
    delete process.env.SITE_URL;
    expect(siteUrl()).toBe('http://localhost:3010');
    process.env.SITE_URL = 'https://loja.exemplo.com.br/';
    expect(siteUrl()).toBe('https://loja.exemplo.com.br');
  });

  it('só é indexável com SITE_INDEXAVEL=true', () => {
    expect(indexavel()).toBe(false);
    process.env.SITE_INDEXAVEL = 'false';
    expect(indexavel()).toBe(false);
    process.env.SITE_INDEXAVEL = 'true';
    expect(indexavel()).toBe(true);
  });

  it('linkWhatsapp usa só os dígitos e põe 55 quando falta', () => {
    expect(linkWhatsapp('(81) 99999-0000')).toBe('https://wa.me/5581999990000');
    expect(linkWhatsapp('5581999990000')).toBe('https://wa.me/5581999990000');
    expect(linkWhatsapp(null)).toBeNull();
    expect(linkWhatsapp('abc')).toBeNull();
  });
});

describe('dados da instalação para o rodapé', () => {
  it('endereço vem da variável e some quando vazio', async () => {
    const { enderecoEmpresa } = await import('./site');
    delete process.env.EMPRESA_ENDERECO;
    expect(enderecoEmpresa()).toBeNull();
    process.env.EMPRESA_ENDERECO = '  Rua Exemplo, 100 - Centro, Recife/PE  ';
    expect(enderecoEmpresa()).toBe('Rua Exemplo, 100 - Centro, Recife/PE');
    delete process.env.EMPRESA_ENDERECO;
  });
  it('advertência de bebida só com a variável ligada', async () => {
    const { vendeBebidaAlcoolica } = await import('./site');
    delete process.env.VENDE_BEBIDA_ALCOOLICA;
    expect(vendeBebidaAlcoolica()).toBe(false);
    process.env.VENDE_BEBIDA_ALCOOLICA = 'true';
    expect(vendeBebidaAlcoolica()).toBe(true);
    delete process.env.VENDE_BEBIDA_ALCOOLICA;
  });
});
