import { resolverInscricaoEstadual } from './inscricao-estadual';

describe('resolverInscricaoEstadual', () => {
  it('CPF nunca grava IE, mesmo se vier no payload', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CPF', inscricaoEstadual: '123456789' })).toEqual({ ok: true, valor: null });
  });

  it('CNPJ isento grava a string ISENTO', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', isentoIe: true })).toEqual({ ok: true, valor: 'ISENTO' });
  });

  it('isento ganha da IE preenchida', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', isentoIe: true, inscricaoEstadual: '0612345' })).toEqual({ ok: true, valor: 'ISENTO' });
  });

  it('CNPJ com IE grava so os digitos', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '06.123.456-7' })).toEqual({ ok: true, valor: '061234567' });
  });

  it('CNPJ sem IE e sem isento e recusado', () => {
    const r = resolverInscricaoEstadual({ tipo: 'CNPJ' });
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, erro: 'Informe a Inscrição Estadual ou marque Isento' });
  });

  it('IE curta ou longa demais e recusada', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '1234567' }).ok).toBe(false);
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '123456789012345' }).ok).toBe(false);
  });

  it('aceita os extremos de 8 e 14 digitos', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '12345678' })).toEqual({ ok: true, valor: '12345678' });
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '12345678901234' })).toEqual({ ok: true, valor: '12345678901234' });
  });
});
