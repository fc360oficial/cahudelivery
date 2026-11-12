import { describe, expect, it } from 'vitest';
import { hrefCom, lerFiltros, type Filtros } from './filtros';

const M = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const PADRAO: Filtros = { pagina: 1, ordem: 'nome', marca: null, sub: null };

describe('lerFiltros', () => {
  it('sem parâmetros devolve o padrão', () => {
    expect(lerFiltros({})).toEqual(PADRAO);
  });
  it('lê valores válidos', () => {
    expect(lerFiltros({ pagina: '3', ordem: 'preco_asc', marca: M, sub: S })).toEqual({ pagina: 3, ordem: 'preco_asc', marca: M, sub: S });
  });
  it('descarta valores inválidos (não chegam à API)', () => {
    expect(lerFiltros({ pagina: '-2', ordem: 'drop', marca: 'x', sub: ['y', S] })).toEqual(PADRAO);
    expect(lerFiltros({ pagina: 'abc' }).pagina).toBe(1);
    expect(lerFiltros({ pagina: '9999' }).pagina).toBe(500);
  });
});

describe('hrefCom', () => {
  it('omite o que é padrão', () => {
    expect(hrefCom('/c/x', PADRAO, {})).toBe('/c/x');
  });
  it('mudar filtro volta para a página 1', () => {
    expect(hrefCom('/c/x', { ...PADRAO, pagina: 4 }, { ordem: 'preco_desc' })).toBe('/c/x?ordem=preco_desc');
  });
  it('mudar só a página mantém os filtros', () => {
    expect(hrefCom('/c/x', { ...PADRAO, marca: M }, { pagina: 2 })).toBe(`/c/x?marca=${M}&pagina=2`);
  });
  it('parâmetros fixos (busca) vêm primeiro', () => {
    expect(hrefCom('/busca', PADRAO, { pagina: 2 }, { q: 'café torrado' })).toBe('/busca?q=caf%C3%A9+torrado&pagina=2');
  });
});
