import { geocodificar, EnderecoGeo, USER_AGENT } from './geocodificador';

const end: EnderecoGeo = { cep: '51240-300', logradouro: 'Rua Muniz Ferreira', numero: '101', cidade: 'Recife', uf: 'PE' };
const semEspera = async () => undefined;

function resposta(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const vazio = () => resposta(200, []);
const hit = (lat: string, lon: string, address?: Record<string, string>) => resposta(200, [{ lat, lon, address }]);

describe('geocodificar', () => {
  it('1ª etapa: rua com número, precisão endereco, com município do Nominatim', async () => {
    const fetchFn = jest.fn(async () => hit('-8.1287217', '-34.9380845', { city: 'Recife', suburb: 'Ibura' }));
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c).toEqual({ lat: -8.1287217, lng: -34.9380845, precisao: 'endereco', cidade: 'Recife' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(url).toContain('street=101+Rua+Muniz+Ferreira');
    expect(url).toContain('city=Recife');
    expect(url).toContain('state=PE');
    expect(url).toContain('countrycodes=br');
    expect(url).toContain('addressdetails=1');
    const init = fetchFn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('2ª etapa: rua sem número quando o número não resolve', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(vazio()).mockResolvedValueOnce(hit('-8.12', '-34.93'));
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c?.precisao).toBe('endereco');
    expect(String(fetchFn.mock.calls[1][0])).toContain('street=Rua+Muniz+Ferreira&');
    expect(String(fetchFn.mock.calls[1][0])).not.toContain('street=101');
  });

  it('3ª etapa: busca livre "rua, cidade, UF"', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(vazio()).mockResolvedValueOnce(vazio()).mockResolvedValueOnce(hit('-8.12', '-34.93'));
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c?.precisao).toBe('endereco');
    expect(String(fetchFn.mock.calls[2][0])).toContain('q=Rua+Muniz+Ferreira%2C+Recife%2C+PE');
  });

  it('4ª etapa: só o CEP, precisão cep, quando a rua não resolve de jeito nenhum', async () => {
    const fetchFn = jest.fn().mockResolvedValueOnce(vazio()).mockResolvedValueOnce(vazio()).mockResolvedValueOnce(vazio()).mockResolvedValueOnce(hit('-8.1295501', '-34.9379357'));
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c).toEqual({ lat: -8.1295501, lng: -34.9379357, precisao: 'cep', cidade: null });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect(String(fetchFn.mock.calls[3][0])).toContain('postalcode=51240-300');
  });

  it('espera 1 s entre etapas (limite do Nominatim), mas não antes da primeira', async () => {
    const esperar = jest.fn(async () => undefined);
    const fetchFn = jest.fn().mockResolvedValueOnce(vazio()).mockResolvedValueOnce(vazio()).mockResolvedValueOnce(hit('-8.12', '-34.93'));
    await geocodificar(end, fetchFn, esperar);
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledWith(1000);
  });

  it('sem rua no cadastro vai direto ao CEP', async () => {
    const fetchFn = jest.fn(async () => hit('-8.12', '-34.93'));
    const c = await geocodificar({ ...end, logradouro: '', numero: '' }, fetchFn, semEspera);
    expect(c?.precisao).toBe('cep');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('não chama a BrasilAPI em nenhuma etapa', async () => {
    const fetchFn = jest.fn(async () => vazio());
    await geocodificar(end, fetchFn, semEspera);
    for (const [url] of fetchFn.mock.calls) expect(String(url)).not.toContain('brasilapi');
  });

  it('usa town quando não há city (município pequeno)', async () => {
    const fetchFn = jest.fn(async () => hit('-8.0', '-35.0', { town: 'Goiana' }));
    expect((await geocodificar(end, fetchFn, semEspera))?.cidade).toBe('Goiana');
  });

  it('devolve null quando nenhuma etapa resolve', async () => {
    const fetchFn = jest.fn(async () => resposta(500, {}));
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('devolve null quando a rede falha', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
  });

  it('CEP inválido não gera etapa de CEP', async () => {
    const fetchFn = jest.fn(async () => vazio());
    expect(await geocodificar({ ...end, cep: '123' }, fetchFn, semEspera)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('ignora coordenada não numérica', async () => {
    const fetchFn = jest.fn(async () => hit('abc', 'x'));
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
  });
});
