import { deveRodarAgora, GeocodificacaoWorker } from './geocodificacao.worker';

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
});
