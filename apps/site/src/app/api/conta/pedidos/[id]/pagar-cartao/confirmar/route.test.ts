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
const chamar = () =>
  POST(new Request(`http://localhost:3011/api/conta/pedidos/${ID}/pagar-cartao/confirmar`, {
    method: 'POST', headers: { origin: 'http://localhost:3011', host: 'localhost:3011' },
  }), { params: Promise.resolve({ id: ID }) });

describe('POST /api/conta/pedidos/[id]/pagar-cartao/confirmar', () => {
  beforeEach(() => { pote.clear(); pote.set('fc_acesso', jwt); });
  afterEach(() => vi.unstubAllGlobals());

  it('creditado passa como está (a tela mostra "valor virou crédito")', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { status: 'creditado' })));
    expect(await (await chamar()).json()).toEqual({ status: 'creditado' });
  });

  it('status fora da lista vira desconhecido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { status: 'qualquer' })));
    expect(await (await chamar()).json()).toEqual({ status: 'desconhecido' });
  });
});
