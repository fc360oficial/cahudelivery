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

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

const DISPOSITIVO = '3f1c2a4e-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const CORPO_VALIDO = {
  tipo: 'CNPJ', documento: '11.222.333/0001-81', nomeFantasia: 'Mercadinho Teste', razaoSocial: '', inscricaoEstadual: '',
  isentoIe: true, email: '', telefone: '(81) 99999-0000', categoria: '',
  endereco: { cep: '51210-050', logradouro: 'Rua A', numero: '10', complemento: '', bairro: 'Imbiribeira', cidade: 'Recife', uf: 'PE', codigoMunicipio: '2611606' },
  senha: 'senha-forte-1', codigoIndicacao: '', paginaWeb: '',
};

let ipSeq = 0;
const novoIp = () => `10.1.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

const pedido = (corpo: unknown, op: { origem?: string; ip?: string } = {}) =>
  new Request('http://localhost:3011/api/sessao/cadastro', {
    method: 'POST',
    headers: {
      origin: op.origem ?? 'http://localhost:3011', host: 'localhost:3011', 'content-type': 'application/json',
      'x-forwarded-for': op.ip ?? novoIp(),
    },
    body: JSON.stringify(corpo),
  });

const PAR = { clienteId: 'c-1', status: 'pendente', accessToken: 'acesso.secreto.x', refreshToken: 'renova-secreto' };

describe('POST /api/sessao/cadastro', () => {
  beforeEach(() => {
    pote.clear();
    pote.set('fc_dispositivo', { valor: DISPOSITIVO, opcoes: {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('Origin de outro site: 403 antes de tudo', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    const r = await POST(pedido(CORPO_VALIDO, { origem: 'https://golpe.example' }));
    expect(r.status).toBe(403);
    expect(buscar).not.toHaveBeenCalled();
    expect(pote.has('fc_acesso')).toBe(false);
  });

  it('sucesso: chama auth/registrar só com os campos do RegistrarDto, grava cookies HttpOnly e não devolve token', async () => {
    const buscar = vi.fn(async (_url: string, _init: RequestInit) => resposta(201, PAR));
    vi.stubGlobal('fetch', buscar);
    const r = await POST(pedido(CORPO_VALIDO, { ip: '200.1.2.3' }));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ logado: true, status: 'pendente' });
    expect(texto).not.toContain('secreto');
    expect(texto).not.toContain('c-1');

    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0]!;
    expect(url).toMatch(/\/auth\/registrar$/);
    expect(init.method).toBe('POST');
    const h = init.headers as Record<string, string>;
    expect(h['X-Device-Id']).toBe(DISPOSITIVO);
    expect(h['X-Forwarded-For']).toBe('200.1.2.3');
    expect(h['X-Tenant']).toBeTruthy();
    expect(JSON.parse(String(init.body))).toEqual({
      tipo: 'CNPJ', documento: '11222333000181', nomeFantasia: 'Mercadinho Teste', isentoIe: true, telefone: '81999990000',
      endereco: { cep: '51210050', logradouro: 'Rua A', numero: '10', bairro: 'Imbiribeira', cidade: 'Recife', uf: 'PE', codigoMunicipio: '2611606' },
      senha: 'senha-forte-1',
    });

    expect(pote.get('fc_acesso')).toMatchObject({ valor: 'acesso.secreto.x', opcoes: { httpOnly: true, sameSite: 'lax', path: '/' } });
    expect(pote.get('fc_renova')).toMatchObject({ valor: 'renova-secreto', opcoes: { httpOnly: true, sameSite: 'lax', path: '/' } });
  });

  it('sem fc_dispositivo válido, não manda X-Device-Id', async () => {
    pote.set('fc_dispositivo', { valor: 'nao-e-uuid', opcoes: {} });
    const buscar = vi.fn(async (_url: string, _init: RequestInit) => resposta(201, PAR));
    vi.stubGlobal('fetch', buscar);
    await POST(pedido(CORPO_VALIDO));
    expect((buscar.mock.calls[0]![1].headers as Record<string, string>)['X-Device-Id']).toBeUndefined();
  });

  it('campo-armadilha preenchido: responde como sucesso sem chamar a API nem gravar sessão', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    const r = await POST(pedido({ ...CORPO_VALIDO, paginaWeb: 'http://spam.example' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ logado: true, status: 'pendente' });
    expect(buscar).not.toHaveBeenCalled();
    expect(pote.has('fc_acesso')).toBe(false);
  });

  it('corpo inválido: 400 com os erros por campo, sem chamar a API', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    const r = await POST(pedido({ ...CORPO_VALIDO, documento: '11222333000182', senha: '123' }));
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.mensagem).toBeTruthy();
    expect(j.erros).toMatchObject({ documento: 'CNPJ inválido', senha: 'Mínimo de 6 caracteres' });
    expect(buscar).not.toHaveBeenCalled();
  });

  it('documento já cadastrado: repassa a mensagem e o código da API', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(409, { statusCode: 409, message: 'Já existe cadastro para este CNPJ/CPF. Use Entrar.', codigo: 'CLIENTE_JA_EXISTE' })));
    const r = await POST(pedido(CORPO_VALIDO));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ mensagem: 'Já existe cadastro para este CNPJ/CPF. Use Entrar.', codigo: 'CLIENTE_JA_EXISTE' });
    expect(pote.has('fc_acesso')).toBe(false);
  });

  it('erro interno da API não vaza', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(500, { message: 'duplicate key value violates unique constraint' })));
    const r = await POST(pedido(CORPO_VALIDO));
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain('duplicate');
  });

  it('resposta sem par de tokens: 500 e nenhum cookie', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(201, { status: 'pendente' })));
    const r = await POST(pedido(CORPO_VALIDO));
    expect(r.status).toBe(500);
    expect(pote.has('fc_acesso')).toBe(false);
  });

  it('5 tentativas que chegam à API por hora por IP; corpo inválido não conta', async () => {
    const buscar = vi.fn(async () => resposta(409, { message: 'Já existe cadastro para este CNPJ/CPF. Use Entrar.', codigo: 'CLIENTE_JA_EXISTE' }));
    vi.stubGlobal('fetch', buscar);
    const ip = novoIp();
    for (let i = 0; i < 3; i++) expect((await POST(pedido({ ...CORPO_VALIDO, documento: '1' }, { ip }))).status).toBe(400);
    for (let i = 0; i < 5; i++) expect((await POST(pedido(CORPO_VALIDO, { ip }))).status).toBe(409);
    const bloqueada = await POST(pedido(CORPO_VALIDO, { ip }));
    expect(bloqueada.status).toBe(429);
    expect((await bloqueada.json()).mensagem).toMatch(/Muitas tentativas de cadastro/);
    expect(buscar).toHaveBeenCalledTimes(5);
    // Outro IP segue livre.
    expect((await POST(pedido(CORPO_VALIDO))).status).toBe(409);
  });
});
