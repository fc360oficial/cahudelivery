import { CODIGO_MAX_TENTATIVAS, gerarCodigoAcesso, hashCodigoAcesso, normalizarCodigo } from './codigo-acesso';
import { hashSenhaProvisoria, senhaFraca } from './senha-provisoria';
import * as argon2 from 'argon2';

describe('código de acesso', () => {
  it('gera 8 caracteres sem os que confundem por telefone', () => {
    for (let i = 0; i < 200; i++) expect(gerarCodigoAcesso()).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });

  it('aceita o código digitado de qualquer jeito', () => {
    expect(normalizarCodigo(' abcd efgh ')).toBe('ABCDEFGH');
    expect(hashCodigoAcesso('c1', 'abcd-efgh')).toBe(hashCodigoAcesso('c1', 'ABCDEFGH'));
  });

  it('o mesmo código não serve para outro cliente', () => {
    expect(hashCodigoAcesso('c1', 'ABCD-EFGH')).not.toBe(hashCodigoAcesso('c2', 'ABCD-EFGH'));
  });

  it('limita as tentativas por código', () => {
    expect(CODIGO_MAX_TENTATIVAS).toBe(5);
  });
});

describe('senha', () => {
  it('recusa a antiga senha padrão, sequências e o documento', () => {
    expect(senhaFraca('123456', '11222333000181')).toBe(true);
    expect(senhaFraca('11222333000181', '11222333000181')).toBe(true);
    expect(senhaFraca('Cahu#2026', '11222333000181')).toBe(false);
  });

  it('conta nova do ERP não aceita 123456', async () => {
    await expect(argon2.verify(await hashSenhaProvisoria(), '123456')).resolves.toBe(false);
  });
});
