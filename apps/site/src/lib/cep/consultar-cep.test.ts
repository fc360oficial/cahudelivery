import { afterEach, describe, expect, it, vi } from 'vitest';
import { consultarCep } from './consultar-cep';

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

describe('consultarCep', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chama só o host fixo do ViaCEP, sem cache, sem seguir redirecionamento e com tempo limite', async () => {
    const buscar = vi.fn(async (_url: string, _init: RequestInit) =>
      resposta(200, { logradouro: 'Rua A', bairro: 'B', localidade: 'Recife', uf: 'PE', ibge: '2611606', ddd: '81' }));
    vi.stubGlobal('fetch', buscar);
    const r = await consultarCep('51210050');
    expect(r).toEqual({ tipo: 'encontrado', endereco: { logradouro: 'Rua A', bairro: 'B', cidade: 'Recife', uf: 'PE', codigoMunicipio: '2611606' } });
    expect(buscar).toHaveBeenCalledTimes(1);
    const [url, init] = buscar.mock.calls[0]!;
    expect(url).toBe('https://viacep.com.br/ws/51210050/json/');
    expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('CEP fora de 8 dígitos nem chega a montar a URL', async () => {
    const buscar = vi.fn();
    vi.stubGlobal('fetch', buscar);
    for (const cep of ['5121005', '51210-050', '../x/12', '51210050?a=1']) {
      expect(await consultarCep(cep)).toEqual({ tipo: 'invalido' });
    }
    expect(buscar).not.toHaveBeenCalled();
  });

  it('CEP inexistente', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(200, { erro: 'true' })));
    expect(await consultarCep('99999999')).toEqual({ tipo: 'nao-encontrado' });
  });

  it('serviço fora, status de erro ou corpo que não é JSON: falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await consultarCep('51210050')).toEqual({ tipo: 'falha' });
    vi.stubGlobal('fetch', vi.fn(async () => resposta(500, {})));
    expect(await consultarCep('51210050')).toEqual({ tipo: 'falha' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response));
    expect(await consultarCep('51210050')).toEqual({ tipo: 'falha' });
  });
});
