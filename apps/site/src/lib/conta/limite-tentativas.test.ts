import { describe, expect, it } from 'vitest';
import { criarLimite, sujeitoDoJwt } from './limite-tentativas';

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (payload: unknown) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.assinatura`;
const MIN = 60_000;

describe('criarLimite', () => {
  it('bloqueia depois do máximo de falhas dentro da janela', () => {
    const limite = criarLimite({ maximo: 3, janelaMs: 15 * MIN });
    expect(limite.bloqueado('a', 0)).toBe(false);
    limite.registrarFalha('a', 0);
    limite.registrarFalha('a', 1 * MIN);
    expect(limite.bloqueado('a', 2 * MIN)).toBe(false);
    limite.registrarFalha('a', 2 * MIN);
    expect(limite.bloqueado('a', 3 * MIN)).toBe(true);
  });

  it('libera quando as falhas saem da janela', () => {
    const limite = criarLimite({ maximo: 2, janelaMs: 15 * MIN });
    limite.registrarFalha('a', 0);
    limite.registrarFalha('a', 1 * MIN);
    expect(limite.bloqueado('a', 10 * MIN)).toBe(true);
    expect(limite.bloqueado('a', 16 * MIN + 1)).toBe(false);
  });

  it('cada chave conta separado e o acerto zera a contagem', () => {
    const limite = criarLimite({ maximo: 1, janelaMs: 15 * MIN });
    limite.registrarFalha('a', 0);
    expect(limite.bloqueado('a', 1)).toBe(true);
    expect(limite.bloqueado('b', 1)).toBe(false);
    limite.limpar('a');
    expect(limite.bloqueado('a', 2)).toBe(false);
  });

  it('não cresce sem limite: chaves vencidas são descartadas', () => {
    const limite = criarLimite({ maximo: 5, janelaMs: 1 * MIN, maximoDeChaves: 3 });
    for (const k of ['a', 'b', 'c']) limite.registrarFalha(k, 0);
    limite.registrarFalha('d', 2 * MIN);
    expect(limite.tamanho()).toBe(1);
  });
});

describe('sujeitoDoJwt', () => {
  it('lê o sub do payload', () => {
    expect(sujeitoDoJwt(jwt({ sub: 'cli-1', exp: 1 }))).toBe('cli-1');
  });
  it('nulo quando malformado ou sem sub', () => {
    expect(sujeitoDoJwt('abc')).toBeNull();
    expect(sujeitoDoJwt(jwt({ exp: 1 }))).toBeNull();
    expect(sujeitoDoJwt(jwt({ sub: 7 }))).toBeNull();
    expect(sujeitoDoJwt(`a.${b64url('não é json')}.c`)).toBeNull();
  });
});
