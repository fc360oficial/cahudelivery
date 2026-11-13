import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => new Headers(),
}));

const { GET } = await import('./route');

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;
const VIACEP = { cep: '51210-050', logradouro: 'Rua A', bairro: 'Imbiribeira', localidade: 'Recife', uf: 'PE', ibge: '2611606', ddd: '81', siafi: '2531' };

let ipSeq = 0;
const novoIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const consultar = (cep: string, ip: string) =>
  GET(new Request(`http://localhost:3011/api/cep/${cep}`, { headers: { 'x-forwarded-for': ip } }), { params: Promise.resolve({ cep }) });

describe('GET /api/cep/[cep] (público)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('devolve só a lista branca, sem cache no navegador', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(200, VIACEP)));
    const r = await consultar('51210050', novoIp());
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ logradouro: 'Rua A', bairro: 'Imbiribeira', cidade: 'Recife', uf: 'PE', codigoMunicipio: '2611606' });
  });

  it('CEP malformado: 400 sem chamar o serviço externo', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    for (const cep of ['5121005', '51210-050', 'abcdefgh', '512100501', '%2e%2e']) {
      const r = await consultar(cep, novoIp());
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ mensagem: 'CEP inválido.' });
    }
    expect(buscar).not.toHaveBeenCalled();
  });

  it('mesmo CEP de novo sai do cache em memória (não martela o ViaCEP)', async () => {
    const buscar = vi.fn(async () => resposta(200, VIACEP));
    vi.stubGlobal('fetch', buscar);
    await consultar('51210051', novoIp());
    const r = await consultar('51210051', novoIp());
    expect(r.status).toBe(200);
    expect(buscar).toHaveBeenCalledTimes(1);
  });

  it('falha do serviço não fica no cache; CEP inexistente fica', async () => {
    const fora = vi.fn(async () => { throw new TypeError('fetch failed'); });
    vi.stubGlobal('fetch', fora);
    expect((await consultar('51210052', novoIp())).status).toBe(503);
    const volta = vi.fn(async () => resposta(200, { erro: 'true' }));
    vi.stubGlobal('fetch', volta);
    expect((await consultar('51210052', novoIp())).status).toBe(404);
    expect((await consultar('51210052', novoIp())).status).toBe(404);
    expect(volta).toHaveBeenCalledTimes(1);
  });

  it('30 consultas por IP em 10 minutos; a 31ª recebe 429 e outro IP segue livre', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(200, VIACEP)));
    const ip = novoIp();
    for (let i = 0; i < 30; i++) expect((await consultar(String(60000000 + i), ip)).status).toBe(200);
    const bloqueada = await consultar('60000099', ip);
    expect(bloqueada.status).toBe(429);
    expect((await bloqueada.json()).mensagem).toMatch(/Muitas consultas de CEP/);
    expect((await consultar('60000099', novoIp())).status).toBe(200);
  });
});
