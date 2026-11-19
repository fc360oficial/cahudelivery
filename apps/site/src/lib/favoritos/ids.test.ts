import { describe, expect, it } from 'vitest';
import { lerPendente, montarPendente, normalizarFavoritos, VALIDADE_PENDENTE_MS } from './ids';

const A = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';
const B = '1b2c3d4e-0000-4000-8000-aabbccddeeff';

describe('normalizarFavoritos', () => {
  it('fica só com ids válidos, sem repetir e em minúsculas', () => {
    expect(normalizarFavoritos([A, B.toUpperCase(), A, 'x', 12, null])).toEqual([A, B]);
  });
  it('qualquer coisa que não seja lista vira lista vazia', () => {
    expect(normalizarFavoritos(null)).toEqual([]);
    expect(normalizarFavoritos({ dados: [A] })).toEqual([]);
    expect(normalizarFavoritos('erro')).toEqual([]);
  });
});

describe('favorito pendente do visitante', () => {
  const agora = 1_800_000_000_000;
  it('vale logo depois de guardado', () => {
    expect(lerPendente(montarPendente(A, agora), agora + 60_000)).toBe(A);
  });
  it('vence depois do prazo', () => {
    expect(lerPendente(montarPendente(A, agora), agora + VALIDADE_PENDENTE_MS + 1)).toBeNull();
  });
  it('ignora texto estranho, id fora do formato e data no futuro', () => {
    expect(lerPendente(null, agora)).toBeNull();
    expect(lerPendente('{', agora)).toBeNull();
    expect(lerPendente('null', agora)).toBeNull();
    expect(lerPendente(JSON.stringify({ id: 'abc', quando: agora }), agora)).toBeNull();
    expect(lerPendente(JSON.stringify({ id: A }), agora)).toBeNull();
    expect(lerPendente(montarPendente(A, agora + 5_000), agora)).toBeNull();
  });
});
