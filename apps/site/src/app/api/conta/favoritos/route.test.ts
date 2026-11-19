import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cookies de verdade não existem fora do Next: um pote em memória faz o papel do cookies().
const pote = new Map<string, { valor: string; opcoes: Record<string, unknown> }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (pote.has(nome) ? { name: nome, value: pote.get(nome)!.valor } : undefined),
    set: (nome: string, valor: string, opcoes: Record<string, unknown>) => { pote.set(nome, { valor, opcoes }); },
  }),
  headers: async () => new Headers(),
}));

const { GET } = await import('./route');
const { POST, DELETE } = await import('./[produtoId]/route');

const A = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (sub: string) =>
  `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))}.assinatura`;
const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

const pedido = (caminho: string, metodo: string, comOrigem = true) =>
  new Request(`http://localhost:3011${caminho}`, {
    method: metodo,
    headers: { host: 'localhost:3011', ...(comOrigem ? { origin: 'http://localhost:3011' } : {}) },
  });
const contexto = (produtoId: string) => ({ params: Promise.resolve({ produtoId }) });

describe('/api/conta/favoritos', () => {
  beforeEach(() => {
    pote.clear();
    pote.set('fc_acesso', { valor: jwt('cliente-1'), opcoes: {} });
    pote.set('fc_renova', { valor: 'renova-1', opcoes: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('GET devolve só os ids válidos que a API mandou', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(200, [A, 'lixo', A])));
    const r = await GET(pedido('/api/conta/favoritos', 'GET'));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([A]);
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('GET sem sessão: 401 e a API nem é chamada', async () => {
    pote.clear();
    const chamada = vi.fn(async () => resposta(200, []));
    vi.stubGlobal('fetch', chamada);
    const r = await GET(pedido('/api/conta/favoritos', 'GET'));
    expect(r.status).toBe(401);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('POST marca o produto na API com o token do cliente', async () => {
    const chamada = vi.fn(async (..._args: unknown[]) => resposta(201, { ok: true }));
    vi.stubGlobal('fetch', chamada);
    const r = await POST(pedido(`/api/conta/favoritos/${A}`, 'POST'), contexto(A));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const [url, init] = chamada.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/favoritos/${A}$`));
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('DELETE desmarca o produto na API', async () => {
    const chamada = vi.fn(async (..._args: unknown[]) => resposta(200, { ok: true }));
    vi.stubGlobal('fetch', chamada);
    const r = await DELETE(pedido(`/api/conta/favoritos/${A}`, 'DELETE'), contexto(A));
    expect(r.status).toBe(200);
    expect((chamada.mock.calls[0] as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('id fora do formato: 404 sem chamar a API', async () => {
    const chamada = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', chamada);
    const r = await POST(pedido('/api/conta/favoritos/abc', 'POST'), contexto('abc'));
    expect(r.status).toBe(404);
    expect(chamada).not.toHaveBeenCalled();
  });

  it('POST vindo de outro site (sem Origin do próprio site): 403', async () => {
    const chamada = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', chamada);
    const r = await POST(pedido(`/api/conta/favoritos/${A}`, 'POST', false), contexto(A));
    expect(r.status).toBe(403);
    expect(chamada).not.toHaveBeenCalled();
  });
});
