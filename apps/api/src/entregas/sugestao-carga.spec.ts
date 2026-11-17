import { sugerirCargas, type CaminhaoParaCarga, type EntregaParaCarga } from './sugestao-carga';

const e = (id: string, cidade: string, bairro: string, pesoKg: number | null, cliente = `Cliente ${id}`): EntregaParaCarga => ({ id, cidade, bairro, cliente, pesoKg });
const c = (id: string, capacidadeKg: number | null, regiao: string | null = null): CaminhaoParaCarga => ({ id, capacidadeKg, regiao });
const ids = (r: ReturnType<typeof sugerirCargas>, caminhaoId: string) => r.cargas.find((x) => x.caminhaoId === caminhaoId)?.entregaIds;

describe('sugerirCargas', () => {
  it('sem entregas não sugere nada', () => {
    expect(sugerirCargas([], [c('c1', 3500)])).toEqual({ cargas: [], fora: [] });
  });

  it('uma cidade por caminhão; a nota e o cadastro escrevem a cidade diferente e é a mesma', () => {
    const r = sugerirCargas(
      [e('1', 'JABOATAO DOS GUARARAPES', 'Prazeres', 300), e('2', 'Jaboatão dos Guararapes', 'Candeias', 600), e('3', 'Cabo de Santo Agostinho', 'Pontezinha', 200)],
      [c('c1', 3500), c('c2', 3500)],
    );
    expect(r.fora).toEqual([]);
    expect(r.cargas).toEqual([
      { caminhaoId: 'c1', entregaIds: ['2', '1'], pesoKg: 900 }, // a cidade com mais peso escolhe primeiro; dentro dela, por bairro
      { caminhaoId: 'c2', entregaIds: ['3'], pesoKg: 200 },
    ]);
  });

  it('notas do mesmo cliente ficam juntas (viram uma parada só)', () => {
    const r = sugerirCargas(
      [e('1', 'Recife', 'Ibura', 10, 'Mercadinho B'), e('2', 'Recife', 'Ibura', 10, 'Mercadinho A'), e('3', 'Recife', 'Ibura', 10, 'Mercadinho B')],
      [c('c1', 3500)],
    );
    expect(ids(r, 'c1')).toEqual(['2', '1', '3']);
  });

  it('caminhão da região tem preferência, pela cidade ou por um bairro dela', () => {
    const r = sugerirCargas(
      [e('1', 'Jaboatão dos Guararapes', 'Prazeres', 900), e('2', 'Cabo de Santo Agostinho', 'Ponte dos Carvalhos', 300), e('3', 'Recife', 'Ibura', 100)],
      [c('c1', 3500, 'Recife sul'), c('c2', 3500, 'Cabo'), c('c3', 3500, 'Prazeres')],
    );
    expect(ids(r, 'c3')).toEqual(['1']); // bairro Prazeres
    expect(ids(r, 'c2')).toEqual(['2']); // "Cabo" dentro de "Cabo de Santo Agostinho"
    expect(ids(r, 'c1')).toEqual(['3']); // "Recife" dentro de "Recife sul"
    expect(r.fora).toEqual([]);
  });

  it('cidade sem caminhão de costume não toma o caminhão que é de costume de outra', () => {
    const r = sugerirCargas(
      [e('1', 'Jaboatão dos Guararapes', 'Prazeres', 900), e('2', 'Cabo de Santo Agostinho', 'Centro', 300)],
      [c('c1', 3500, 'Cabo'), c('c2', 3500)],
    );
    expect(ids(r, 'c2')).toEqual(['1']);
    expect(ids(r, 'c1')).toEqual(['2']);
  });

  it('respeita o peso do caminhão: o que passa vai para o próximo, e o menor que ainda cabe entra', () => {
    const r = sugerirCargas(
      [e('1', 'Recife', 'A', 2000), e('2', 'Recife', 'B', 1500), e('3', 'Recife', 'C', 900)],
      [c('c1', 3000), c('c2', 3000)],
    );
    expect(r.cargas).toEqual([
      { caminhaoId: 'c1', entregaIds: ['1', '3'], pesoKg: 2900 },
      { caminhaoId: 'c2', entregaIds: ['2'], pesoKg: 1500 },
    ]);
    expect(r.fora).toEqual([]);
  });

  it('acabaram os caminhões: a cidade que sobrou é encaixada onde ainda cabe', () => {
    const r = sugerirCargas([e('1', 'Recife', 'Ibura', 1000), e('2', 'Ipojuca', 'Centro', 200)], [c('c1', 3500)]);
    expect(r.cargas).toEqual([{ caminhaoId: 'c1', entregaIds: ['1', '2'], pesoKg: 1200 }]);
    expect(r.fora).toEqual([]);
  });

  it('não cabe em nenhuma carga: fica fora por falta de caminhão', () => {
    const r = sugerirCargas([e('1', 'Recife', 'Ibura', 3000), e('2', 'Ipojuca', 'Centro', 800)], [c('c1', 3500)]);
    expect(ids(r, 'c1')).toEqual(['1']);
    expect(r.fora).toEqual([{ id: '2', motivo: 'sem_caminhao' }]);
  });

  it('entrega mais pesada que o maior caminhão fica fora como "não cabe" e não atrapalha as outras', () => {
    const r = sugerirCargas([e('1', 'Recife', 'Ibura', 5000), e('2', 'Recife', 'Jordão', 400)], [c('c1', 3500), c('c2', 3000)]);
    expect(r.fora).toEqual([{ id: '1', motivo: 'nao_cabe' }]);
    expect(r.cargas).toEqual([{ caminhaoId: 'c1', entregaIds: ['2'], pesoKg: 400 }]);
  });

  it('caminhão sem peso informado não limita; entrega sem peso conta zero', () => {
    const r = sugerirCargas([e('1', 'Recife', 'Ibura', 9000), e('2', 'Recife', 'Jordão', null)], [c('c1', null)]);
    expect(r.cargas).toEqual([{ caminhaoId: 'c1', entregaIds: ['1', '2'], pesoKg: 9000 }]);
  });

  it('sem caminhão livre, tudo fica fora por falta de caminhão', () => {
    const r = sugerirCargas([e('1', 'Recife', 'Ibura', 100), e('2', 'Cabo', 'Centro', null)], []);
    expect(r.cargas).toEqual([]);
    expect(r.fora).toEqual([{ id: '1', motivo: 'sem_caminhao' }, { id: '2', motivo: 'sem_caminhao' }]);
  });

  it('cada entrega aparece uma vez só, numa carga ou fora', () => {
    const entregas = Array.from({ length: 40 }, (_, i) => e(String(i), ['Recife', 'Jaboatão', 'Cabo', 'Ipojuca'][i % 4], `B${i % 7}`, 150 + (i % 5) * 220));
    const r = sugerirCargas(entregas, [c('c1', 3500, 'Recife'), c('c2', 3500, 'Cabo'), c('c3', 4000)]);
    const todos = [...r.cargas.flatMap((x) => x.entregaIds), ...r.fora.map((f) => f.id)].sort();
    expect(todos).toEqual(entregas.map((x) => x.id).sort());
    for (const carga of r.cargas) {
      const limite = { c1: 3500, c2: 3500, c3: 4000 }[carga.caminhaoId]!;
      expect(carga.pesoKg).toBeLessThanOrEqual(limite);
      expect(carga.pesoKg).toBeCloseTo(carga.entregaIds.reduce((s, id) => s + entregas[Number(id)].pesoKg!, 0), 1);
    }
  });
});
