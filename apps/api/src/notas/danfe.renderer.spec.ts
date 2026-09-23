import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe, NotaFiscalLida } from './nfe-xml.parser';
import { ALTURA_DADOS_ADICIONAIS, COLUNAS, LARGURA, renderizarDanfe } from './danfe.renderer';

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

describe('tabela de itens', () => {
  it('as colunas cabem exatamente na largura util da pagina', () => {
    // Bug real de 22/09/2026: as colunas somavam 594pt numa area de 539,28pt e
    // "VL. ICMS" e "%" eram desenhadas fora da folha A4.
    const soma = COLUNAS.reduce((s, c) => s + c.largura, 0);
    expect(soma).toBeCloseTo(LARGURA, 2);
  });
});

import { inflateSync } from 'node:zlib';

/** Streams de conteúdo do PDF já descomprimidos (pdfkit usa FlateDecode). */
function streamsDoPdf(pdf: Buffer): string[] {
  const bruto = pdf.toString('latin1');
  const saida: string[] = [];
  for (const m of bruto.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    try {
      saida.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'));
    } catch {
      // stream não comprimido (fontes etc.) — não interessa aqui
    }
  }
  return saida;
}

/** Blocos de texto (pdfkit escreve `TJ` com strings hex) em { y, texto }. */
function textosDoPdf(pdf: Buffer): Array<{ y: number; texto: string }> {
  const blocos: Array<{ y: number; texto: string }> = [];
  for (const conteudo of streamsDoPdf(pdf)) {
    for (const b of conteudo.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm\s*\n\/\w+ [\d.]+ Tf\s*\n\[(.*?)\] TJ/gs)) {
      const texto = [...b[2].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('');
      blocos.push({ y: Number(b[1]), texto });
    }
  }
  return blocos;
}

/** Retângulos desenhados (operador `re`), em coordenadas do pdfkit (y cresce para baixo). */
function retangulosDoPdf(pdf: Buffer): Array<{ y: number; h: number }> {
  const rects: Array<{ y: number; h: number }> = [];
  for (const conteudo of streamsDoPdf(pdf)) {
    for (const r of conteudo.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re\b/g)) {
      rects.push({ y: Number(r[2]), h: Number(r[4]) });
    }
  }
  return rects;
}

describe('a nota preenche a folha', () => {
  it('traz os quadros de transportador e dados adicionais e o último quadro encosta no rodapé', async () => {
    // Bug real de 22/09/2026: o PDF parava logo após os itens e 2/3 da folha
    // ficavam em branco — o cliente via "metade da nota".
    const pdf = await renderizarDanfe(nota);
    const textos = textosDoPdf(pdf).map((b) => b.texto);
    expect(textos).toContain('TRANSPORTADOR / VOLUMES TRANSPORTADOS');
    expect(textos).toContain('DADOS ADICIONAIS');
    expect(textos).toContain('9 - Sem frete');
    // O quadro de dados adicionais tem altura fixa (não estica até o rodapé — na
    // tela do celular virava um retângulo vazio enorme) e tudo fica dentro da folha.
    const rects = retangulosDoPdf(pdf);
    expect(rects.some((r) => r.h === ALTURA_DADOS_ADICIONAIS)).toBe(true);
    expect(Math.max(...rects.map((r) => r.y + r.h))).toBeLessThanOrEqual(841.89 - 28 + 0.01);
    expect(textos.length).toBeGreaterThan(90);
  });
});
