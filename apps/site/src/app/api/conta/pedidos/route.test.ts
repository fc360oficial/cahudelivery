import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pote = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (pote.has(nome) ? { name: nome, value: pote.get(nome)! } : undefined),
    set: (nome: string, valor: string) => { pote.set(nome, valor); },
  }),
  headers: async () => new Headers(),
}));

const { POST } = await import('./route');

const ID = '7ea763be-96e8-4844-b8fc-3723e898b7f3';
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub: 'c1', exp: Math.floor(Date.now() / 1000) + 600 }))}.assinatura`;
const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;
const CONFIG = { appNome: 'CAHU Delivery', configuracoes: { formas_pagamento: ['pix'] } };
const DESLIGADO = 'O fechamento de pedido pelo site ainda não está disponível. Finalize pelo app CAHU Delivery.';

/** API falsa: /config responde a config; /pedidos responde o pedido criado. */
const apiFalsa = () =>
  vi.fn(async (url: string) =>
    url.endsWith('/config') ? resposta(200, CONFIG) : resposta(201, { id: ID, numero: 12, status: 'RECEBIDO', pagamento: null }));
const caminhos = (f: ReturnType<typeof apiFalsa>) => f.mock.calls.map(([url]) => new URL(url).pathname);

const pedido = (corpo: unknown, origem = 'http://localhost:3011') =>
  new Request('http://localhost:3011/api/conta/pedidos', {
    method: 'POST',
    headers: { origin: origem, host: 'localhost:3011', 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

describe('POST /api/conta/pedidos e a chave CHECKOUT_LIGADO', () => {
  beforeEach(() => { pote.clear(); pote.set('fc_acesso', jwt); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.CHECKOUT_LIGADO; });

  it('desligada (ausente): 503 com a mensagem, sem criar pedido na API, mesmo com corpo inválido', async () => {
    const f = apiFalsa();
    vi.stubGlobal('fetch', f);
    for (const corpo of [{ tipoEntrega: 'retirada', formaPagamento: 'pix' }, { lixo: true }]) {
      const r = await POST(pedido(corpo));
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ mensagem: DESLIGADO });
    }
    expect(caminhos(f).every((c) => c.endsWith('/config'))).toBe(true); // só a config pública (nome do app)
  });

  it('desligada com qualquer valor diferente de "true"', async () => {
    process.env.CHECKOUT_LIGADO = 'TRUE';
    const f = apiFalsa();
    vi.stubGlobal('fetch', f);
    expect((await POST(pedido({ tipoEntrega: 'retirada', formaPagamento: 'pix' }))).status).toBe(503);
    expect(caminhos(f).some((c) => c.endsWith('/pedidos'))).toBe(false);
  });

  it('desligada e config fora do ar: 503 mesmo assim, sem nome do app', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => resposta(500, { message: 'fora' })));
    const r = await POST(pedido({ tipoEntrega: 'retirada', formaPagamento: 'pix' }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ mensagem: 'O fechamento de pedido pelo site ainda não está disponível. Finalize pelo app.' });
  });

  it('desligada: Origin de fora continua 403 e sem sessão continua 401', async () => {
    const f = apiFalsa();
    vi.stubGlobal('fetch', f);
    expect((await POST(pedido({}, 'https://outro.com'))).status).toBe(403);
    pote.clear();
    expect((await POST(pedido({}))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('ligada: segue o fluxo atual (valida e cria o pedido na API)', async () => {
    process.env.CHECKOUT_LIGADO = 'true';
    const f = apiFalsa();
    vi.stubGlobal('fetch', f);
    const r = await POST(pedido({ tipoEntrega: 'retirada', formaPagamento: 'pix' }));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ id: ID, numero: '12', status: 'RECEBIDO', pagamento: null });
    expect(caminhos(f).some((c) => c.endsWith('/pedidos'))).toBe(true);
    expect((await POST(pedido({ lixo: true }))).status).toBe(400);
  });
});
