import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarApi, ErroApi, TEMPO_LIMITE_PAGAMENTO_MS } from './cliente';

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

  it('com token manda Authorization Bearer; com ipCliente manda X-Forwarded-For', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/perfil', { token: 'tok.en.x', ipCliente: '200.1.2.3' });
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok.en.x');
    expect(h['X-Forwarded-For']).toBe('200.1.2.3');
  });

  it('pedido e pagamento do site: X-Canal site e o User-Agent do navegador (cortado em 255)', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/pedidos', { metodo: 'POST', corpo: {}, token: 't', canal: 'site', userAgent: `Mozilla/5.0 ${'x'.repeat(400)}` });
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h['X-Canal']).toBe('site');
    expect(h['User-Agent']).toHaveLength(255);
    expect(h['User-Agent'].startsWith('Mozilla/5.0 ')).toBe(true);
  });

  it('User-Agent com quebra de linha ou vazio não é repassado', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/pedidos', { userAgent: 'a\r\nX-Injetado: 1' });
    await chamarApi('/pedidos', { userAgent: '   ' });
    for (const chamada of fetchFalso.mock.calls as unknown as [string, RequestInit][]) {
      const h = chamada[1].headers as Record<string, string>;
      expect(h).not.toHaveProperty('User-Agent');
      expect(h).not.toHaveProperty('X-Canal');
    }
  });

  it('sem token nem ipCliente não manda esses cabeçalhos', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/carrinho', { deviceId: 'dev-1' });
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(h).not.toHaveProperty('Authorization');
    expect(h).not.toHaveProperty('X-Forwarded-For');
  });

  it('erro da API guarda o codigo quando vem (p.ex. PRIMEIRO_ACESSO_PENDENTE)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(401, { message: 'Crie sua senha', codigo: 'PRIMEIRO_ACESSO_PENDENTE' })));
    await expect(chamarApi('/auth/login')).rejects.toMatchObject({ status: 401, codigo: 'PRIMEIRO_ACESSO_PENDENTE' });
    vi.stubGlobal('fetch', vi.fn(async () => resposta(401, { message: 'x', codigo: 42 })));
    const erro = (await chamarApi('/auth/login').catch((e: unknown) => e)) as ErroApi;
    expect(erro.codigo).toBeUndefined();
  });

  it('erro da API vira ErroApi com a mensagem dela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(404, { message: 'Produto não encontrado' })));
    await expect(chamarApi('/produtos/x')).rejects.toMatchObject({ status: 404, message: 'Produto não encontrado' });
  });

  it('mensagem em lista (validação do Nest) é juntada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(400, { message: ['a', 'b'] })));
    await expect(chamarApi('/x')).rejects.toMatchObject({ status: 400, message: 'a. b' });
  });

  describe('tempo limite', () => {
    /** fetch que só termina se for abortado (API pendurada). */
    const fetchPendurado = () =>
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_ok, falha) => {
        init.signal?.addEventListener('abort', () => falha(init.signal!.reason));
      }));
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('sem cache: 30 s por padrão; esgotou vira ErroApi 504 em português', async () => {
      const f = fetchPendurado();
      vi.stubGlobal('fetch', f);
      const p = chamarApi('/pedidos?pagina=1', { token: 't' }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(29_999);
      expect((f.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const erro = (await p) as ErroApi;
      expect(erro).toBeInstanceOf(ErroApi);
      expect(erro.status).toBe(504);
      expect(erro.message).toBe('O servidor demorou para responder. Tente novamente.');
    });

    it('aceita outro valor (60 s em pedido e cartão)', async () => {
      vi.stubGlobal('fetch', fetchPendurado());
      const p = chamarApi('/pedidos', { metodo: 'POST', corpo: {}, tempoLimiteMs: TEMPO_LIMITE_PAGAMENTO_MS }).catch((e: unknown) => e);
      expect(TEMPO_LIMITE_PAGAMENTO_MS).toBe(60_000);
      await vi.advanceTimersByTimeAsync(30_000);
      let terminou = false;
      void p.then(() => { terminou = true; });
      await vi.advanceTimersByTimeAsync(0);
      expect(terminou).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(((await p) as ErroApi).status).toBe(504);
    });

    it('resposta a tempo não é abortada depois (o relógio é desligado)', async () => {
      const f = vi.fn(async (_u: string, _i: RequestInit) => resposta(200, { ok: 1 }));
      vi.stubGlobal('fetch', f);
      await expect(chamarApi('/perfil', { token: 't' })).resolves.toEqual({ ok: 1 });
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  it('API fora do ar vira ErroApi 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const erro = (await chamarApi('/home').catch((e: unknown) => e)) as ErroApi;
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(503);
  });
});
