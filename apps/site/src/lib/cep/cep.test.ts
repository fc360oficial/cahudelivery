import { describe, expect, it } from 'vitest';
import { cepExato, criarCacheCep, extrairEndereco } from './cep';

describe('cepExato', () => {
  it('só exatamente 8 dígitos', () => {
    expect(cepExato('51210050')).toBe('51210050');
    for (const v of ['5121005', '512100500', '51210-050', ' 51210050', '5121005a', '../../x', '', null, 51210050]) {
      expect(cepExato(v)).toBeNull();
    }
  });
});

describe('extrairEndereco', () => {
  const viaCep = {
    cep: '51210-050', logradouro: ' Rua Exemplo ', complemento: 'x', unidade: '', bairro: 'Imbiribeira', localidade: 'Recife',
    uf: 'pe', estado: 'Pernambuco', regiao: 'Nordeste', ibge: '2611606', gia: '', ddd: '81', siafi: '2531',
  };

  it('lista branca: logradouro, bairro, cidade, UF e código do município; nada mais passa', () => {
    expect(extrairEndereco(viaCep)).toEqual({
      logradouro: 'Rua Exemplo', bairro: 'Imbiribeira', cidade: 'Recife', uf: 'PE', codigoMunicipio: '2611606',
    });
  });

  it('corta textos longos e descarta UF e código fora do formato', () => {
    const e = extrairEndereco({ ...viaCep, logradouro: 'a'.repeat(300), ibge: '26116<script>' });
    expect(e?.logradouro).toHaveLength(120);
    expect(e?.codigoMunicipio).toBeNull();
    // Sem cidade ou com UF fora do formato a resposta não serve: nulo (e por isso nunca vai para o cache).
    expect(extrairEndereco({ ...viaCep, uf: 'Pernambuco' })).toBeNull();
    expect(extrairEndereco({ ...viaCep, localidade: '' })).toBeNull();
    expect(extrairEndereco({})).toBeNull();
    expect(extrairEndereco({ ...viaCep, bairro: 7, ibge: 2611606 })).toMatchObject({ bairro: '', codigoMunicipio: null });
  });

  it('CEP inexistente (erro true ou "true") ou resposta estranha: nulo', () => {
    expect(extrairEndereco({ erro: true })).toBeNull();
    expect(extrairEndereco({ erro: 'true' })).toBeNull();
    expect(extrairEndereco(null)).toBeNull();
    expect(extrairEndereco([viaCep])).toBeNull();
    expect(extrairEndereco('texto')).toBeNull();
  });
});

describe('criarCacheCep', () => {
  const MIN = 60_000;

  it('devolve o que foi gravado até vencer', () => {
    const cache = criarCacheCep<string>({ validadeMs: 10 * MIN, maximoDeEntradas: 10 });
    cache.gravar('51210050', 'a', 0);
    expect(cache.ler('51210050', 9 * MIN)).toBe('a');
    expect(cache.ler('51210050', 10 * MIN)).toBeUndefined();
    expect(cache.tamanho()).toBe(0);
  });

  it('respeita o teto de entradas descartando a mais antiga', () => {
    const cache = criarCacheCep<number>({ validadeMs: 10 * MIN, maximoDeEntradas: 2 });
    cache.gravar('00000001', 1, 0);
    cache.gravar('00000002', 2, 1);
    cache.gravar('00000003', 3, 2);
    expect(cache.tamanho()).toBe(2);
    expect(cache.ler('00000001', 3)).toBeUndefined();
    expect(cache.ler('00000002', 3)).toBe(2);
    expect(cache.ler('00000003', 3)).toBe(3);
  });

  it('antes de descartar a mais antiga, joga fora as vencidas', () => {
    const cache = criarCacheCep<number>({ validadeMs: 10, maximoDeEntradas: 2 });
    cache.gravar('00000001', 1, 0);
    cache.gravar('00000002', 2, 100);
    cache.gravar('00000003', 3, 105);
    expect(cache.ler('00000002', 106)).toBe(2);
    expect(cache.ler('00000003', 106)).toBe(3);
  });
});
