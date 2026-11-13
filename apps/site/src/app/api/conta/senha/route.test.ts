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

const { POST } = await import('./route');

const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (sub: string) =>
  `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))}.assinatura`;
const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

const pedido = (corpo: unknown) =>
  new Request('http://localhost:3011/api/conta/senha', {
    method: 'POST',
    headers: { origin: 'http://localhost:3011', host: 'localhost:3011', 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });

describe('POST /api/conta/senha', () => {
  beforeEach(() => {
    pote.clear();
    pote.set('fc_acesso', { valor: jwt('cliente-1'), opcoes: {} });
    pote.set('fc_renova', { valor: 'renova-antigo', opcoes: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('grava o par novo da API nos cookies e não devolve token nenhum ao navegador', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { ok: true, accessToken: 'acesso.novo.x', refreshToken: 'renova-novo' })));
    const r = await POST(pedido({ senhaAtual: 'antiga-1', novaSenha: 'nova-senha-1' }));
    expect(r.status).toBe(200);
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ ok: true });
    expect(texto).not.toContain('novo');
    expect(pote.get('fc_acesso')?.valor).toBe('acesso.novo.x');
    expect(pote.get('fc_renova')?.valor).toBe('renova-novo');
    expect(pote.get('fc_renova')?.opcoes).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
  });

  it('resposta sem par válido: troca vale, cookies ficam como estavam', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { ok: true })));
    const r = await POST(pedido({ senhaAtual: 'antiga-1', novaSenha: 'nova-senha-1' }));
    expect(r.status).toBe(200);
    expect(pote.get('fc_renova')?.valor).toBe('renova-antigo');
  });

  it('senha atual errada: 400 com a mensagem e nenhum cookie novo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(401, { message: 'Senha atual incorreta' })));
    const r = await POST(pedido({ senhaAtual: 'errada-1', novaSenha: 'nova-senha-1' }));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ mensagem: 'Senha atual incorreta' });
    expect(pote.get('fc_renova')?.valor).toBe('renova-antigo');
  });
});
