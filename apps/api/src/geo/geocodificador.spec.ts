import { geocodificar, EnderecoGeo, USER_AGENT } from './geocodificador';

const end: EnderecoGeo = { cep: '51240-300', logradouro: 'Rua Muniz Ferreira', numero: '101', bairro: 'Ibura', cidade: 'Recife', uf: 'PE' };
const semEspera = async () => undefined;

function resposta(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const vazio = () => resposta(200, []);
const hit = (lat: string, lon: string, address?: Record<string, string>) => resposta(200, [{ lat, lon, address }]);
const viacep = (v: Record<string, unknown>) => resposta(200, v);
const viacepOk = () => viacep({ logradouro: 'Rua Muniz Ferreira', bairro: 'Ibura', localidade: 'Recife', uf: 'PE' });
const viacepErro = () => viacep({ erro: true });

/** fetch mockado por URL: ViaCEP responde com `via`, Nominatim com a sequência `nom`. */
function fetchDe(via: () => Response, nom: (() => Response)[]) {
  let i = 0;
  const fn = jest.fn(async (url: string) => (url.startsWith('https://viacep.com.br/') ? via() : (nom[i++] ?? vazio)()));
  return fn;
}
const urlsNominatim = (fn: jest.Mock) => fn.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('nominatim'));

describe('geocodificar', () => {
  it('consulta o ViaCEP primeiro e depois o Nominatim por rua e número (precisão endereco)', async () => {
    const fetchFn = fetchDe(viacepOk, [() => hit('-8.1287217', '-34.9380845', { city: 'Recife' })]);
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c).toEqual({ lat: -8.1287217, lng: -34.9380845, precisao: 'endereco', cidade: 'Recife' });
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://viacep.com.br/ws/51240300/json/');
    const url = urlsNominatim(fetchFn)[0];
    expect(url).toContain('street=101+Rua+Muniz+Ferreira');
    expect(url).toContain('city=Recife');
    expect(url).toContain('state=PE');
    expect(url).toContain('countrycodes=br');
    expect(url).toContain('addressdetails=1');
    const init = fetchFn.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('usa rua, bairro, cidade e UF do ViaCEP no lugar do cadastro sujo', async () => {
    const sujo: EnderecoGeo = { cep: '54480350', logradouro: 'RUA ITAPEMIRIM', numero: '0', bairro: 'CANDEIAS', cidade: 'JABAOATAO DOS GUARARAPES', uf: '' };
    const fetchFn = fetchDe(
      () => viacep({ logradouro: 'Rua Itapemirim', bairro: 'Candeias', localidade: 'Jaboatão dos Guararapes', uf: 'PE' }),
      [() => hit('-8.2', '-34.9')],
    );
    await geocodificar(sujo, fetchFn, semEspera);
    const url = urlsNominatim(fetchFn)[0];
    expect(url).toContain('street=Rua+Itapemirim&'); // número "0" ignorado: vai direto na etapa sem número
    expect(url).toContain('city=Jaboat%C3%A3o+dos+Guararapes');
    expect(url).toContain('state=PE');
  });

  it('sem UF não manda state vazio', async () => {
    const fetchFn = fetchDe(viacepErro, [() => hit('-8.2', '-34.9')]);
    await geocodificar({ ...end, uf: '' }, fetchFn, semEspera);
    expect(urlsNominatim(fetchFn)[0]).not.toContain('state=');
  });

  it('número colado no logradouro ("AV HARMINIO MOURA,391") vira número', async () => {
    const fetchFn = fetchDe(viacepErro, [() => hit('-8.2', '-34.9')]);
    await geocodificar({ ...end, logradouro: 'AV HARMINIO MOURA,391', numero: '0' }, fetchFn, semEspera);
    expect(urlsNominatim(fetchFn)[0]).toContain('street=391+AV+HARMINIO+MOURA');
  });

  it('cascata: rua+nº → rua → livre → bairro → CEP', async () => {
    const fetchFn = fetchDe(viacepOk, [vazio, vazio, vazio, vazio, () => hit('-8.1295501', '-34.9379357')]);
    const c = await geocodificar(end, fetchFn, semEspera);
    expect(c).toEqual({ lat: -8.1295501, lng: -34.9379357, precisao: 'cep', cidade: null });
    const urls = urlsNominatim(fetchFn);
    expect(urls).toHaveLength(5);
    expect(urls[1]).toContain('street=Rua+Muniz+Ferreira&');
    expect(urls[2]).toContain('q=Rua+Muniz+Ferreira%2C+Ibura%2C+Recife%2C+PE');
    expect(urls[3]).toContain('q=Ibura%2C+Recife%2C+PE');
    expect(urls[4]).toContain('postalcode=51240-300');
  });

  it('etapa de bairro devolve precisão cep (aproximada)', async () => {
    const fetchFn = fetchDe(viacepOk, [vazio, vazio, vazio, () => hit('-8.12', '-34.93')]);
    expect((await geocodificar(end, fetchFn, semEspera))?.precisao).toBe('cep');
  });

  it('espera 1 s entre etapas do Nominatim, mas não antes da primeira nem no ViaCEP', async () => {
    const esperar = jest.fn(async () => undefined);
    const fetchFn = fetchDe(viacepOk, [vazio, vazio, () => hit('-8.12', '-34.93')]);
    await geocodificar(end, fetchFn, esperar);
    expect(esperar).toHaveBeenCalledTimes(2);
    expect(esperar).toHaveBeenCalledWith(1000);
  });

  it('sem CEP válido não chama o ViaCEP nem a etapa de CEP', async () => {
    const fetchFn = fetchDe(viacepOk, [vazio, vazio, vazio, vazio, vazio]);
    expect(await geocodificar({ ...end, cep: '123' }, fetchFn, semEspera)).toBeNull();
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes('viacep'))).toBe(false);
    expect(urlsNominatim(fetchFn)).toHaveLength(4);
  });

  it('sem rua nem bairro no cadastro e ViaCEP sem resposta vai direto ao CEP', async () => {
    const fetchFn = fetchDe(viacepErro, [() => hit('-8.12', '-34.93')]);
    const c = await geocodificar({ ...end, logradouro: '', numero: '', bairro: '' }, fetchFn, semEspera);
    expect(c?.precisao).toBe('cep');
    expect(urlsNominatim(fetchFn)).toHaveLength(1);
  });

  it('não chama a BrasilAPI em nenhuma etapa', async () => {
    const fetchFn = fetchDe(viacepOk, [vazio, vazio, vazio, vazio, vazio]);
    await geocodificar(end, fetchFn, semEspera);
    for (const [url] of fetchFn.mock.calls) expect(String(url)).not.toContain('brasilapi');
  });

  it('usa town quando não há city (município pequeno)', async () => {
    const fetchFn = fetchDe(viacepOk, [() => hit('-8.0', '-35.0', { town: 'Goiana' })]);
    expect((await geocodificar(end, fetchFn, semEspera))?.cidade).toBe('Goiana');
  });

  it('devolve null quando nenhuma etapa resolve', async () => {
    const fetchFn = jest.fn(async () => resposta(500, {}));
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
  });

  it('ignora coordenada não numérica', async () => {
    const fetchFn = fetchDe(viacepOk, [() => hit('abc', 'x'), vazio, vazio, vazio, vazio]);
    expect(await geocodificar(end, fetchFn, semEspera)).toBeNull();
  });
});
