import { describe, expect, it } from 'vitest';
import { codigoPixValido, svgDoPix } from './qr-pix';

// BR Code real de exemplo do manual do Banco Central (chave aleatória fictícia).
const BR_CODE = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

describe('codigoPixValido', () => {
  it('aceita texto imprimível de uma linha, até 512 caracteres', () => {
    expect(codigoPixValido(BR_CODE)).toBe(true);
    expect(codigoPixValido('MOCKPIX-ref-79.90')).toBe(true);
  });
  it('recusa vazio, quebra de linha, controle, não-texto e grande demais', () => {
    expect(codigoPixValido('')).toBe(false);
    expect(codigoPixValido('abc\ndef')).toBe(false);
    expect(codigoPixValido('abc\u0000')).toBe(false);
    expect(codigoPixValido(null)).toBe(false);
    expect(codigoPixValido(123)).toBe(false);
    expect(codigoPixValido('x'.repeat(513))).toBe(false);
  });
});

describe('svgDoPix', () => {
  it('gera um SVG de QR (só formas, sem script nem texto do código)', async () => {
    const svg = await svgDoPix(BR_CODE);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    expect(svg).not.toContain('br.gov.bcb.pix');
  });

  it('mesmo código, mesmo desenho; código diferente, desenho diferente', async () => {
    expect(await svgDoPix(BR_CODE)).toBe(await svgDoPix(BR_CODE));
    expect(await svgDoPix(BR_CODE)).not.toBe(await svgDoPix(`${BR_CODE.slice(0, -4)}ABCD`));
  });

  it('código inválido não vira QR', async () => {
    await expect(svgDoPix('a\nb')).rejects.toThrow();
  });
});
