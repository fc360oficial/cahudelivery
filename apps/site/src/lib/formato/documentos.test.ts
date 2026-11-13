import { describe, expect, it } from 'vitest';
import { formatarData, formatarDataHora } from './datas';
import { formatarCep, formatarDocumento, formatarTelefone } from './documentos';

describe('formatarDocumento', () => {
  it('CPF e CNPJ com pontuação', () => {
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
  });
  it('aceita já pontuado e devolve igual', () => {
    expect(formatarDocumento('529.982.247-25')).toBe('529.982.247-25');
  });
  it('o resto volta como veio; vazio vira travessão', () => {
    expect(formatarDocumento('123')).toBe('123');
    expect(formatarDocumento(null)).toBe('—');
    expect(formatarDocumento('')).toBe('—');
  });
});

describe('formatarCep', () => {
  it('8 dígitos com hífen', () => {
    expect(formatarCep('50000000')).toBe('50000-000');
    expect(formatarCep('50000-000')).toBe('50000-000');
  });
  it('fora do formato volta como veio', () => {
    expect(formatarCep('123')).toBe('123');
    expect(formatarCep(null)).toBe('—');
  });
});

describe('formatarTelefone', () => {
  it('celular e fixo com DDD', () => {
    expect(formatarTelefone('81999990000')).toBe('(81) 99999-0000');
    expect(formatarTelefone('8133334444')).toBe('(81) 3333-4444');
  });
  it('tira o 55 do país', () => {
    expect(formatarTelefone('5581999990000')).toBe('(81) 99999-0000');
  });
  it('fora do formato volta como veio', () => {
    expect(formatarTelefone('0800')).toBe('0800');
    expect(formatarTelefone(null)).toBe('—');
  });
});

describe('datas', () => {
  it('dd/mm/aaaa no horário de Brasília', () => {
    expect(formatarData('2026-11-13T02:30:00.000Z')).toBe('12/11/2026');
    expect(formatarData('2026-11-13T15:00:00.000Z')).toBe('13/11/2026');
  });
  it('data pura AAAA-MM-DD não sofre fuso', () => {
    expect(formatarData('2026-12-05')).toBe('05/12/2026');
  });
  it('data e hora', () => {
    expect(formatarDataHora('2026-11-13T15:04:00.000Z')).toBe('13/11/2026 às 12:04');
  });
  it('inválida ou vazia vira travessão', () => {
    expect(formatarData(null)).toBe('—');
    expect(formatarData('lixo')).toBe('—');
    expect(formatarDataHora(undefined)).toBe('—');
  });
});
