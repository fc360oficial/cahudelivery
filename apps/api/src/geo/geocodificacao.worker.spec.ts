import { Logger } from '@nestjs/common';
import { deveRodarAgora, GeocodificacaoWorker } from './geocodificacao.worker';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('deveRodarAgora', () => {
  it('roda às 03:xx se ainda não rodou hoje', () => {
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 0, 30), null)).toBe(true);
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 59, 0), '2026-09-15')).toBe(true);
  });
  it('não roda fora das 03:xx nem duas vezes no mesmo dia', () => {
    expect(deveRodarAgora(new Date(2026, 8, 16, 2, 59, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 16, 4, 0, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 10, 0), '2026-09-16')).toBe(false);
  });
});

describe('GeocodificacaoWorker.processarPendentes', () => {
  function montar(rows: unknown[], coord: unknown) {
    const query = jest.fn(async (sql: string) => (sql.includes('select') ? { rows } : { rows: [] }));
    const db = {
      listActiveTenantSlugs: async () => ['cahu'],
      getTenantPool: async () => ({ query }),
    };
    const geocodificar = jest.fn(async () => coord);
    const w = new GeocodificacaoWorker(db as never, { geocodificar, esperar: async () => undefined });
    return { w, query, geocodificar };
  }

  const linha = { id: 'e1', cep: '56302000', logradouro: 'Rua A', numero: '1', cidade: 'Petrolina', uf: 'PE' };

  it('grava lat/lng quando resolve', async () => {
    const { w, query } = montar([linha], { lat: -9.39, lng: -40.5, precisao: 'cep' });
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set latitude'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual([-9.39, -40.5, 'cep', 'e1']);
    expect(w.estado().emAndamento).toBe(false);
    expect(w.estado().ultimaExecucaoEm).not.toBeNull();
  });

  it('incrementa tentativas quando não resolve', async () => {
    const { w, query } = montar([linha], null);
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('geo_tentativas = geo_tentativas + 1'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['e1']);
  });

  it('dispararAgora não inicia duas execuções ao mesmo tempo', async () => {
    const { w } = montar([linha], null);
    const r1 = w.dispararAgora();
    const r2 = w.dispararAgora();
    expect(r1).toEqual({ iniciado: true, emAndamento: true });
    expect(r2).toEqual({ iniciado: false, emAndamento: true });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('um tenant com pool quebrado não impede os outros', async () => {
    const queryB = jest.fn(async (sql: string) => (sql.includes('select') ? { rows: [linha] } : { rows: [] }));
    const db = {
      listActiveTenantSlugs: async () => ['a', 'b'],
      getTenantPool: async (slug: string) => {
        if (slug === 'a') throw new Error('pool indisponível');
        return { query: queryB };
      },
    };
    const geocodificar = jest.fn(async () => ({ lat: -9.39, lng: -40.5, precisao: 'cep' }));
    const w = new GeocodificacaoWorker(db as never, { geocodificar, esperar: async () => undefined });

    await w.processarPendentes();

    const update = queryB.mock.calls.find(([sql]) => String(sql).includes('set latitude'));
    expect(update).toBeDefined();
    expect(w.estado().emAndamento).toBe(false);
  });

  it('erro no update de um endereço não aborta os demais', async () => {
    const linha2 = { ...linha, id: 'e2' };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('select')) return { rows: [linha, linha2] };
      if (sql.includes('set latitude')) {
        if (query.mock.calls.filter(([s]) => String(s).includes('set latitude')).length === 1) {
          throw new Error('update falhou');
        }
        return { rows: [] };
      }
      return { rows: [] };
    });
    const db = {
      listActiveTenantSlugs: async () => ['cahu'],
      getTenantPool: async () => ({ query }),
    };
    const geocodificar = jest.fn(async () => ({ lat: -9.39, lng: -40.5, precisao: 'cep' }));
    const w = new GeocodificacaoWorker(db as never, { geocodificar, esperar: async () => undefined });

    await w.processarPendentes();

    expect(geocodificar).toHaveBeenCalledTimes(2);
    const updates = query.mock.calls.filter(([sql]) => String(sql).includes('set latitude'));
    expect(updates.length).toBe(2);
    expect(w.estado().emAndamento).toBe(false);
  });

  it('processarPendentes marca a data da rodada', async () => {
    const { w } = montar([linha], null);
    await w.processarPendentes();
    const hoje0310 = new Date();
    hoje0310.setHours(3, 10, 0, 0);
    expect(deveRodarAgora(hoje0310, w['ultimaDataRodada'])).toBe(false);
  });
});
