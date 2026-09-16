import { parseFiltrosMapa, STATUS_PADRAO } from './mapa-filtros';

const hoje = new Date(2026, 8, 16, 10, 0, 0);

describe('parseFiltrosMapa', () => {
  it('padrão: últimos 7 dias e todos os status exceto CANCELADO', () => {
    expect(parseFiltrosMapa({}, hoje)).toEqual({ de: '2026-09-09', ate: '2026-09-16', status: STATUS_PADRAO });
  });
  it('aceita de/ate e lista de status válidos', () => {
    expect(parseFiltrosMapa({ de: '2026-09-01', ate: '2026-09-10', status: 'RECEBIDO,ENTREGUE' }, hoje)).toEqual({
      de: '2026-09-01', ate: '2026-09-10', status: ['RECEBIDO', 'ENTREGUE'],
    });
  });
  it('ignora status desconhecido e datas inválidas', () => {
    const f = parseFiltrosMapa({ de: 'ontem', status: 'XPTO,FATURADO' }, hoje);
    expect(f.de).toBe('2026-09-09');
    expect(f.status).toEqual(['FATURADO']);
  });
  it('lista só com desconhecidos vira o padrão', () => {
    expect(parseFiltrosMapa({ status: 'XPTO' }, hoje).status).toEqual(STATUS_PADRAO);
  });
  it('data inexistente no calendário (30/02) cai no padrão de "de"', () => {
    expect(parseFiltrosMapa({ de: '2026-02-30' }, hoje).de).toBe('2026-09-09');
  });
  it('mês inválido (13) cai no padrão de "ate"', () => {
    expect(parseFiltrosMapa({ ate: '2026-13-01' }, hoje).ate).toBe('2026-09-16');
  });
  it('aceita 29/02 em ano bissexto', () => {
    expect(parseFiltrosMapa({ de: '2024-02-29' }, hoje).de).toBe('2024-02-29');
  });
});
