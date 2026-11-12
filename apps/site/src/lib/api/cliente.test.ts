import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarApi, ErroApi } from './cliente';

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

describe('chamarApi', () => {
  beforeEach(() => {
    process.env.API_URL = 'http://api.teste/v1/';
    process.env.TENANT = 'cahu';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('manda X-Tenant, usa a URL base e devolve o JSON', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await chamarApi<{ ok: number }>('/home', { revalidar: 60 });
    expect(r).toEqual({ ok: 1 });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate: number } }];
    expect(url).toBe('http://api.teste/v1/home');
    expect((init.headers as Record<string, string>)['X-Tenant']).toBe('cahu');
    expect(init.next).toEqual({ revalidate: 60 });
  });

  it('sem revalidar não usa cache; com deviceId e corpo manda os cabeçalhos', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/carrinho/itens', { metodo: 'PUT', corpo: { a: 1 }, deviceId: 'dev-1' });
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"a":1}');
    expect(h['X-Device-Id']).toBe('dev-1');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('erro da API vira ErroApi com a mensagem dela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(404, { message: 'Produto não encontrado' })));
    await expect(chamarApi('/produtos/x')).rejects.toMatchObject({ status: 404, message: 'Produto não encontrado' });
  });

  it('mensagem em lista (validação do Nest) é juntada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(400, { message: ['a', 'b'] })));
    await expect(chamarApi('/x')).rejects.toMatchObject({ status: 400, message: 'a. b' });
  });

  it('API fora do ar vira ErroApi 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const erro = (await chamarApi('/home').catch((e: unknown) => e)) as ErroApi;
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(503);
  });
});
