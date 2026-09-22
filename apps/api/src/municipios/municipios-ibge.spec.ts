import { municipiosDaUf, normalizarNomeMunicipio } from './municipios-ibge';

describe('normalizarNomeMunicipio', () => {
  it('ignora acento, caixa e pontuacao', () => {
    expect(normalizarNomeMunicipio('São Paulo')).toBe(normalizarNomeMunicipio('SAO PAULO'));
    expect(normalizarNomeMunicipio("Santa Cruz do Capibaribe")).toBe('santacruzdocapibaribe');
    expect(normalizarNomeMunicipio("Olho d'Água")).toBe('olhodagua');
  });
});

describe('municipiosDaUf', () => {
  function resposta(body: unknown, ok = true) {
    return jest.fn(async () => ({ ok, json: async () => body })) as never;
  }

  it('indexa os municipios pelo nome normalizado', async () => {
    const mapa = await municipiosDaUf('pe', resposta([{ id: 2611606, nome: 'Recife' }, { id: 2610707, nome: 'Petrolina' }]));
    expect(mapa!.get('recife')).toBe('2611606');
    expect(mapa!.get('petrolina')).toBe('2610707');
  });

  it('chama a UF em maiusculo', async () => {
    const fetchFn = resposta([{ id: 1, nome: 'X' }]);
    await municipiosDaUf('pe', fetchFn);
    expect(String((fetchFn as unknown as jest.Mock).mock.calls[0][0])).toContain('/estados/PE/municipios');
  });

  it('devolve null quando a resposta nao e ok', async () => {
    expect(await municipiosDaUf('PE', resposta([], false))).toBeNull();
  });

  it('devolve null quando a lista vem vazia', async () => {
    expect(await municipiosDaUf('PE', resposta([]))).toBeNull();
  });

  it('devolve null quando a rede falha, sem lancar', async () => {
    const quebrado = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as never;
    expect(await municipiosDaUf('PE', quebrado)).toBeNull();
  });
});
