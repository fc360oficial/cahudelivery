import { Logger } from '@nestjs/common';
import { deveRodarAgora, MunicipiosWorker } from './municipios.worker';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('deveRodarAgora', () => {
  it('roda as 04:xx se ainda nao rodou hoje', () => {
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 0, 30), null)).toBe(true);
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 59, 0), '2026-09-21')).toBe(true);
  });

  it('nao roda fora das 04:xx nem duas vezes no mesmo dia', () => {
    // 03:xx e a janela do worker de geocodificacao: os dois nao podem coincidir.
    expect(deveRodarAgora(new Date(2026, 8, 22, 3, 30, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 22, 5, 0, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 10, 0), '2026-09-22')).toBe(false);
  });
});

describe('MunicipiosWorker.processarPendentes', () => {
  function montar(rows: unknown[], mapa: Map<string, string> | null) {
    const query = jest.fn(async (sql: string) => (sql.trim().startsWith('select') ? { rows } : { rows: [] }));
    const db = {
      listActiveTenantSlugs: async () => ['cahu'],
      getTenantPool: async () => ({ query }),
    };
    const municipiosDaUf = jest.fn(async () => mapa);
    const w = new MunicipiosWorker(db as never, { municipiosDaUf, esperar: async () => undefined });
    return { w, query, municipiosDaUf };
  }

  const linha = { id: 'e1', cidade: 'Petrolina', uf: 'PE' };

  it('grava o codigo quando a cidade casa', async () => {
    const { w, query } = montar([linha], new Map([['petrolina', '2610707']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set codigo_municipio'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['2610707', 'e1']);
    expect(w.estado().emAndamento).toBe(false);
  });

  it('casa ignorando acento e caixa', async () => {
    const { w, query } = montar([{ id: 'e2', cidade: 'SAO PAULO', uf: 'SP' }], new Map([['saopaulo', '3550308']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set codigo_municipio'));
    expect(update![1]).toEqual(['3550308', 'e2']);
  });

  it('incrementa tentativas quando o IBGE respondeu mas a cidade nao existe', async () => {
    const { w, query } = montar([linha], new Map([['recife', '2611606']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('municipio_tentativas = municipio_tentativas + 1'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['e1']);
  });

  it('NAO incrementa tentativas quando a rede falha', async () => {
    const { w, query } = montar([linha], null);
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('municipio_tentativas = municipio_tentativas + 1'));
    expect(update).toBeUndefined();
  });

  it('busca a lista de cada UF uma vez so', async () => {
    const { w, municipiosDaUf } = montar(
      [linha, { id: 'e2', cidade: 'Recife', uf: 'PE' }, { id: 'e3', cidade: 'Petrolina', uf: 'PE' }],
      new Map([['petrolina', '2610707'], ['recife', '2611606']]),
    );
    await w.processarPendentes();
    expect(municipiosDaUf).toHaveBeenCalledTimes(1);
  });
});
