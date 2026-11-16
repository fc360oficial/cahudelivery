import { describe, expect, it } from 'vitest';
import { criarLimite } from '@/lib/conta/limite-tentativas';
import { buscaLiberada, LIMITE_BUSCA } from './limite-busca';

const novo = () => criarLimite(LIMITE_BUSCA);

describe('buscaLiberada', () => {
  it('libera até o teto e recusa a seguinte, no mesmo minuto', () => {
    const limite = novo();
    for (let i = 0; i < LIMITE_BUSCA.maximo; i++) expect(buscaLiberada('200.1.2.3', 1000 + i, limite)).toBe(true);
    expect(buscaLiberada('200.1.2.3', 2000, limite)).toBe(false);
  });

  it('busca recusada não renova o bloqueio: passado um minuto da primeira, volta a liberar', () => {
    const limite = novo();
    for (let i = 0; i < LIMITE_BUSCA.maximo; i++) buscaLiberada('200.1.2.3', 1000, limite);
    for (let i = 0; i < 500; i++) expect(buscaLiberada('200.1.2.3', 30_000, limite)).toBe(false);
    expect(buscaLiberada('200.1.2.3', 1000 + LIMITE_BUSCA.janelaMs, limite)).toBe(true);
  });

  it('um IP no teto não segura os outros', () => {
    const limite = novo();
    for (let i = 0; i < LIMITE_BUSCA.maximo; i++) buscaLiberada('200.1.2.3', 1000, limite);
    expect(buscaLiberada('200.1.2.3', 1001, limite)).toBe(false);
    expect(buscaLiberada('200.9.9.9', 1001, limite)).toBe(true);
  });

  it('sem IP (acesso sem o Caddy na frente): todos dividem a mesma cota', () => {
    const limite = novo();
    for (let i = 0; i < LIMITE_BUSCA.maximo; i++) expect(buscaLiberada(undefined, 1000, limite)).toBe(true);
    expect(buscaLiberada(undefined, 1001, limite)).toBe(false);
  });
});
