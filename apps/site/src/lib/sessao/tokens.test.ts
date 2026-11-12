import { describe, expect, it } from 'vitest';
import { expiracaoDoJwt, precisaRenovar } from './tokens';

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (payload: unknown) => `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}.assinatura`;

describe('expiracaoDoJwt', () => {
  it('lê o exp (segundos) do payload sem verificar a assinatura', () => {
    expect(expiracaoDoJwt(jwt({ sub: 'x', exp: 1_900_000_000 }))).toBe(1_900_000_000);
  });

  it('nulo quando malformado', () => {
    expect(expiracaoDoJwt('')).toBeNull();
    expect(expiracaoDoJwt('abc')).toBeNull();
    expect(expiracaoDoJwt('a.b')).toBeNull();
    expect(expiracaoDoJwt('a.!!!.c')).toBeNull();
    expect(expiracaoDoJwt(`a.${b64url('não é json')}.c`)).toBeNull();
    expect(expiracaoDoJwt(jwt({ sub: 'x' }))).toBeNull();
    expect(expiracaoDoJwt(jwt({ exp: '1900000000' }))).toBeNull();
    expect(expiracaoDoJwt(jwt({ exp: Number.NaN }))).toBeNull();
    expect(expiracaoDoJwt(jwt(null))).toBeNull();
    expect(expiracaoDoJwt(jwt([1]))).toBeNull();
  });
});

describe('precisaRenovar', () => {
  const agora = 1_800_000_000_000; // ms
  const seg = agora / 1000;

  it('renova sem token ou com token malformado', () => {
    expect(precisaRenovar(null, agora)).toBe(true);
    expect(precisaRenovar('lixo', agora)).toBe(true);
  });

  it('renova quando já venceu ou vence em menos de 60 s', () => {
    expect(precisaRenovar(jwt({ exp: seg - 1 }), agora)).toBe(true);
    expect(precisaRenovar(jwt({ exp: seg + 59 }), agora)).toBe(true);
  });

  it('não renova com 60 s ou mais de folga', () => {
    expect(precisaRenovar(jwt({ exp: seg + 60 }), agora)).toBe(false);
    expect(precisaRenovar(jwt({ exp: seg + 900 }), agora)).toBe(false);
  });
});
