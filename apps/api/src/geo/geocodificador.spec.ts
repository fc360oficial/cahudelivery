import { geocodificar, EnderecoGeo } from './geocodificador';

const end: EnderecoGeo = { cep: '56302-000', logradouro: 'Av. Sete de Setembro', numero: '100', cidade: 'Petrolina', uf: 'PE' };

function resposta(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('geocodificar', () => {
  it('resolve pelo CEP na BrasilAPI com precisão cep', async () => {
    const fetchFn = jest.fn(async () =>
      resposta(200, { location: { coordinates: { latitude: '-9.39', longitude: '-40.50' } } }),
    );
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -9.39, lng: -40.5, precisao: 'cep' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://brasilapi.com.br/api/cep/v2/56302000');
  });

  it('cai para o Nominatim quando a BrasilAPI vem sem coordenada', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(200, { location: { coordinates: {} } }))
      .mockResolvedValueOnce(resposta(200, [{ lat: '-9.3891', lon: '-40.5027' }]));
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -9.3891, lng: -40.5027, precisao: 'endereco' });
    const url = String(fetchFn.mock.calls[1][0]);
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(url).toContain('street=100+Av.+Sete+de+Setembro');
    expect(url).toContain('city=Petrolina');
    expect(url).toContain('state=PE');
    expect(url).toContain('countrycodes=br');
    const init = fetchFn.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('FluxoCommerce/1.0 (contato@fluxocerto.com.br)');
  });

  it('devolve null quando nenhuma fonte resolve', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(404, { message: 'CEP não encontrado' }))
      .mockResolvedValueOnce(resposta(200, []));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });
});
