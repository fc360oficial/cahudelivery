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
const NUMERO = '4111111111111111';
const CVV = '987';
const b64url = (s: string) => Buffer.from(s).toString('base64url');
const jwt = (sub: string) =>
  `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 600 }))}.assinatura`;
const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;
const ano = new Date().getFullYear() + 2;
const corpoValido = { numero: '4111 1111 1111 1111', nome: 'MARIA SILVA', validadeMes: 5, validadeAno: ano, cvv: CVV, dispositivo: { altura: 900, largura: 1440, fusoHoras: 3 } };

const pedido = (corpo: unknown, origem = 'http://localhost:3011') =>
  new Request(`http://localhost:3011/api/conta/pedidos/${ID}/pagar-cartao`, {
    method: 'POST',
    headers: { origin: origem, host: 'localhost:3011', 'content-type': 'application/json', 'user-agent': 'Navegador/1.0', 'x-forwarded-for': '200.1.2.3' },
    body: JSON.stringify(corpo),
  });
const chamar = () => POST(pedido(corpoValido), { params: Promise.resolve({ id: ID }) });

describe('POST /api/conta/pedidos/[id]/pagar-cartao', () => {
  let cliente = 0;
  beforeEach(() => {
    pote.clear();
    pote.set('fc_acesso', jwt(`cliente-${++cliente}`)); // cliente novo por teste: o limite é por cliente
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('manda à API o cartão limpo, o dispositivo, X-Canal site, IP e User-Agent; devolve só o resultado', async () => {
    const fetchFalso = vi.fn(async () => resposta(201, { status: 'autenticar', urlAutenticacao: 'https://3ds.banco.com/x', mensagem: 'Conclua' }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'autenticar', urlAutenticacao: 'https://3ds.banco.com/x' });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(new RegExp(`/pedidos/${ID}/pagar-cartao$`));
    const h = init.headers as Record<string, string>;
    expect(h['X-Canal']).toBe('site');
    expect(h['User-Agent']).toBe('Navegador/1.0');
    expect(h['X-Forwarded-For']).toBe('200.1.2.3');
    expect(JSON.parse(String(init.body))).toEqual({ ...corpoValido, numero: NUMERO });
  });

  it('5 recusas em 15 minutos: a 6ª tentativa nem chega à API (429)', async () => {
    const fetchFalso = vi.fn(async () => resposta(201, { status: 'recusado', mensagem: 'Não autorizada' }));
    vi.stubGlobal('fetch', fetchFalso);
    for (let i = 0; i < 5; i++) {
      const r = await chamar();
      expect(await r.json()).toEqual({ status: 'recusado', mensagem: 'Não autorizada' });
    }
    const r = await chamar();
    expect(r.status).toBe(429);
    expect(fetchFalso).toHaveBeenCalledTimes(5);
  });

  it('só a recusa real do cartão conta: erros 4xx/5xx da API (404, 400 indisponível, 409, 500) nunca travam', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const erros: [number, string][] = [
      [404, 'Pedido sem pagamento com cartão'],
      [400, 'Pagamento com cartão indisponível no momento. Tente novamente em instantes.'],
      [409, 'Pagamento em processamento. Aguarde alguns segundos.'],
      [500, 'falha interna'],
    ];
    for (const [status, message] of erros) {
      vi.stubGlobal('fetch', vi.fn(async () => resposta(status, { message })));
      for (let i = 0; i < 6; i++) expect((await chamar()).status).toBe(status);
    }
    // Depois de 24 erros, a recusa real ainda tem as 5 tentativas inteiras.
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { status: 'recusado', mensagem: 'Não autorizada' })));
    for (let i = 0; i < 5; i++) expect((await chamar()).status).toBe(200);
    expect((await chamar()).status).toBe(429);
  });

  it('nem resposta nem log carregam número ou CVV, mesmo com erro da API', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => resposta(500, { message: 'falha interna' })));
    const r = await chamar();
    const texto = await r.text();
    expect(r.status).toBe(500);
    const escrito = log.mock.calls.flat().join(' ');
    for (const segredo of [NUMERO, '4111 1111', CVV]) {
      expect(texto).not.toContain(segredo);
      expect(escrito).not.toContain(segredo);
    }
  });

  it('corpo inválido: 400 sem chamar a API; Origin de fora: 403', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    expect((await POST(pedido({ ...corpoValido, cvv: '1' }), { params: Promise.resolve({ id: ID }) })).status).toBe(400);
    expect((await POST(pedido(corpoValido, 'https://outro.com'), { params: Promise.resolve({ id: ID }) })).status).toBe(403);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
