import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe, NotaFiscalLida } from './nfe-xml.parser';
import { renderizarDanfe } from './danfe.renderer';

const nota = lerNfe(readFileSync(join(__dirname, 'fixtures', 'nfe-5060.xml'), 'utf8'));

describe('renderizarDanfe', () => {
  it('produz um PDF valido', async () => {
    const pdf = await renderizarDanfe(nota);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('aguenta nota com muitos itens sem estourar', async () => {
    const muitos: NotaFiscalLida = {
      ...nota,
      itens: Array.from({ length: 120 }, (_, i) => ({ ...nota.itens[0], numero: i + 1 })),
    };
    const pdf = await renderizarDanfe(muitos);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('nao quebra com campos opcionais ausentes', async () => {
    const magra: NotaFiscalLida = {
      ...nota,
      protocolo: null,
      saidaEm: null,
      informacoesAdicionais: null,
      destinatario: { ...nota.destinatario, ie: null, fone: null },
    };
    const pdf = await renderizarDanfe(magra);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('nao quebra com nota sem itens', async () => {
    const pdf = await renderizarDanfe({ ...nota, itens: [] });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
