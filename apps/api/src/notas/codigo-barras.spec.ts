// apps/api/src/notas/codigo-barras.spec.ts
import { barrasCode128C } from './codigo-barras';

const CHAVE = '26260961920643000148550030000050601000073367';

describe('barrasCode128C', () => {
  it('recusa quantidade impar de digitos', () => {
    expect(() => barrasCode128C('123')).toThrow('par de dígitos');
  });

  it('recusa caractere que nao e digito', () => {
    expect(() => barrasCode128C('12a4')).toThrow('apenas dígitos');
  });

  it('gera start + pares + checksum + stop', () => {
    // 2 pares => 1 start + 2 dados + 1 checksum = 4 simbolos de 6 modulos,
    // mais o stop de 7 modulos.
    expect(barrasCode128C('1234')).toHaveLength(4 * 6 + 7);
  });

  it('comeca com o padrao do Start C (211232)', () => {
    expect(barrasCode128C('1234').slice(0, 6)).toEqual([2, 1, 1, 2, 3, 2]);
  });

  it('termina com o padrao de Stop (2331112)', () => {
    expect(barrasCode128C('1234').slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('codifica a chave de 44 digitos da NF-e', () => {
    // 44 digitos = 22 pares; 1 start + 22 dados + 1 checksum = 24 simbolos.
    expect(barrasCode128C(CHAVE)).toHaveLength(24 * 6 + 7);
  });

  it('so produz larguras de 1 a 4 modulos', () => {
    for (const l of barrasCode128C(CHAVE)) {
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(4);
    }
  });

  it('calcula o checksum conforme a especificacao', () => {
    // "1234" => start C (105), dados 12 e 34.
    // checksum = (105 + 12*1 + 34*2) % 103 = (105 + 12 + 68) % 103 = 185 % 103 = 82
    const barras = barrasCode128C('1234');
    const checksum = barras.slice(3 * 6, 4 * 6); // 4o simbolo
    expect(checksum).toEqual([1, 2, 1, 2, 4, 1]); // PADROES[82] === '121241'
  });
});
