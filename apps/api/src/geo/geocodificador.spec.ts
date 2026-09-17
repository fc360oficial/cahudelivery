import { geocodificar, EnderecoGeo, USER_AGENT } from './geocodificador';

const end: EnderecoGeo = { cep: '51240-300', logradouro: 'Rua Muniz Ferreira', numero: '101', cidade: 'Recife', uf: 'PE' };

function resposta(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('geocodificar', () => {
  it('resolve pela rua e número no Nominatim com precisão endereco', async () => {
    const fetchFn = jest.fn(async () => resposta(200, [{ lat: '-8.1287217', lon: '-34.9380845' }]));
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -8.1287217, lng: -34.9380845, precisao: 'endereco' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(url).toContain('street=101+Rua+Muniz+Ferreira');
    expect(url).toContain('city=Recife');
    expect(url).toContain('state=PE');
    expect(url).toContain('countrycodes=br');
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('cai para o CEP no Nominatim com precisão cep quando a rua não resolve', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(200, []))
      .mockResolvedValueOnce(resposta(200, [{ lat: '-8.1295501', lon: '-34.9379357' }]));
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -8.1295501, lng: -34.9379357, precisao: 'cep' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[1][0])).toContain('postalcode=51240-300');
  });

  it('não chama a BrasilAPI em nenhuma etapa', async () => {
    const fetchFn = jest.fn().mockResolvedValue(resposta(200, []));
    await geocodificar(end, fetchFn);
    for (const [url] of fetchFn.mock.calls) expect(String(url)).not.toContain('brasilapi');
  });

  it('devolve null quando nenhuma etapa resolve', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(resposta(500, {})).mockResolvedValueOnce(resposta(200, []));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });

  it('não tenta pelo CEP quando o CEP é inválido', async () => {
    const fetchFn = jest.fn().mockResolvedValue(resposta(200, []));
    expect(await geocodificar({ ...end, cep: '123' }, fetchFn)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('ignora coordenada não numérica', async () => {
    const fetchFn = jest.fn().mockResolvedValue(resposta(200, [{ lat: 'abc', lon: 'x' }]));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });
});
