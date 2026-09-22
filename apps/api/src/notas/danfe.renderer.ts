import PDFDocument from 'pdfkit';
import { barrasCode128C } from './codigo-barras';
import { NotaFiscalLida, ItemNfe } from './nfe-xml.parser';

const MARGEM = 28;
const LARGURA = 595.28 - MARGEM * 2; // A4 retrato menos as margens

const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const dataHora = (d: Date | null) => (d ? d.toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '');
const dataCurta = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' }) : '');
/** Chave em grupos de 4, como o DANFE oficial imprime. */
const chaveFormatada = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');
const doc11 = (d: string) => (d.length === 14
  ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));

type Doc = InstanceType<typeof PDFDocument>;

/** Caixa com rótulo pequeno em cima e valor embaixo — o tijolo do DANFE. */
function campo(doc: Doc, x: number, y: number, w: number, h: number, rotulo: string, valor: string, opts: { tamanho?: number; alinhar?: 'left' | 'right' | 'center' } = {}) {
  doc.rect(x, y, w, h).stroke();
  doc.fontSize(5).font('Helvetica').text(rotulo.toUpperCase(), x + 3, y + 2.5, { width: w - 6 });
  doc
    .fontSize(opts.tamanho ?? 7.5)
    .font('Helvetica-Bold')
    .text(valor, x + 3, y + 9, { width: w - 6, align: opts.alinhar ?? 'left', ellipsis: true, height: h - 10 });
}

function desenharBarras(doc: Doc, chave: string, x: number, y: number, largura: number, altura: number) {
  const barras = barrasCode128C(chave);
  const modulo = largura / barras.reduce((s, n) => s + n, 0);
  let cursor = x;
  barras.forEach((l, i) => {
    const w = l * modulo;
    if (i % 2 === 0) doc.rect(cursor, y, w, altura).fill('#000'); // par = barra
    cursor += w;
  });
  doc.fillColor('#000');
}

function cabecalho(doc: Doc, nota: NotaFiscalLida, y: number): number {
  const emit = nota.emitente;
  const alturaTopo = 62;

  // Identificação do emitente
  doc.rect(MARGEM, y, 250, alturaTopo).stroke();
  doc.fontSize(9).font('Helvetica-Bold').text(emit.nome, MARGEM + 5, y + 6, { width: 240 });
  doc.fontSize(6.5).font('Helvetica').text(
    `${emit.endereco.logradouro}, ${emit.endereco.numero} - ${emit.endereco.bairro}\n` +
      `${emit.endereco.municipio} / ${emit.endereco.uf} - CEP ${emit.endereco.cep}\n` +
      `CNPJ ${doc11(emit.documento)}   IE ${emit.ie ?? ''}${emit.fone ? `\nFone ${emit.fone}` : ''}`,
    MARGEM + 5,
    y + 22,
    { width: 240 },
  );

  // DANFE + tipo de operação + número/série
  const xDanfe = MARGEM + 250;
  doc.rect(xDanfe, y, 90, alturaTopo).stroke();
  doc.fontSize(11).font('Helvetica-Bold').text('DANFE', xDanfe, y + 5, { width: 90, align: 'center' });
  doc.fontSize(5.5).font('Helvetica').text('Documento Auxiliar da\nNota Fiscal Eletrônica', xDanfe, y + 19, { width: 90, align: 'center' });
  doc.fontSize(6).font('Helvetica-Bold').text('1 - SAÍDA', xDanfe, y + 34, { width: 90, align: 'center' });
  doc.fontSize(7).text(`Nº ${nota.numero}\nSÉRIE ${nota.serie}`, xDanfe, y + 43, { width: 90, align: 'center' });

  // Código de barras + chave
  const xBarras = xDanfe + 90;
  const wBarras = LARGURA - 340;
  doc.rect(xBarras, y, wBarras, alturaTopo).stroke();
  desenharBarras(doc, nota.chave, xBarras + 5, y + 5, wBarras - 10, 28);
  doc.fontSize(5).font('Helvetica').text('CHAVE DE ACESSO', xBarras + 5, y + 36, { width: wBarras - 10 });
  doc.fontSize(6.5).font('Helvetica-Bold').text(chaveFormatada(nota.chave), xBarras + 5, y + 43, { width: wBarras - 10 });

  let yy = y + alturaTopo;
  campo(doc, MARGEM, yy, 250, 18, 'Natureza da operação', nota.naturezaOperacao);
  campo(doc, MARGEM + 250, yy, LARGURA - 250, 18, 'Protocolo de autorização',
    nota.protocolo ? `${nota.protocolo} - ${dataHora(nota.emissaoEm)}` : 'NÃO AUTORIZADA');
  return yy + 18;
}

function parte(doc: Doc, titulo: string, p: NotaFiscalLida['destinatario'], y: number, extras: Array<[string, string]>): number {
  doc.fontSize(6).font('Helvetica-Bold').text(titulo.toUpperCase(), MARGEM, y + 1);
  let yy = y + 9;
  campo(doc, MARGEM, yy, LARGURA - 210, 20, 'Nome / Razão social', p.nome);
  campo(doc, MARGEM + LARGURA - 210, yy, 110, 20, 'CNPJ / CPF', doc11(p.documento));
  campo(doc, MARGEM + LARGURA - 100, yy, 100, 20, 'Inscrição estadual', p.ie ?? 'ISENTO');
  yy += 20;
  campo(doc, MARGEM, yy, LARGURA - 250, 20, 'Endereço', `${p.endereco.logradouro}, ${p.endereco.numero} - ${p.endereco.bairro}`);
  campo(doc, MARGEM + LARGURA - 250, yy, 130, 20, 'Município', p.endereco.municipio);
  campo(doc, MARGEM + LARGURA - 120, yy, 40, 20, 'UF', p.endereco.uf, { alinhar: 'center' });
  campo(doc, MARGEM + LARGURA - 80, yy, 80, 20, 'CEP', p.endereco.cep);
  yy += 20;
  const w = LARGURA / extras.length;
  extras.forEach(([rotulo, valor], i) => campo(doc, MARGEM + i * w, yy, w, 20, rotulo, valor));
  return yy + 20 + 4;
}

function impostos(doc: Doc, nota: NotaFiscalLida, y: number): number {
  doc.fontSize(6).font('Helvetica-Bold').text('CÁLCULO DO IMPOSTO', MARGEM, y + 1);
  const t = nota.totais;
  const linha: Array<[string, number]> = [
    ['Base de cálculo do ICMS', t.baseIcms],
    ['Valor do ICMS', t.valorIcms],
    ['Valor do frete', t.valorFrete],
    ['Valor do seguro', t.valorSeguro],
    ['Desconto', t.valorDesconto],
    ['Valor do IPI', t.valorIpi],
    ['Total dos produtos', t.valorProdutos],
    ['Total da nota', t.valorTotal],
  ];
  const w = LARGURA / linha.length;
  linha.forEach(([rotulo, valor], i) =>
    campo(doc, MARGEM + i * w, y + 9, w, 20, rotulo, moeda(valor), { tamanho: 6.5, alinhar: 'right' }),
  );
  return y + 9 + 20 + 4;
}

const COLUNAS: Array<{ titulo: string; largura: number; alinhar: 'left' | 'right' | 'center'; valor: (i: ItemNfe) => string }> = [
  { titulo: 'Código', largura: 62, alinhar: 'left', valor: (i) => i.codigo },
  { titulo: 'Descrição', largura: 168, alinhar: 'left', valor: (i) => i.descricao },
  { titulo: 'NCM', largura: 42, alinhar: 'center', valor: (i) => i.ncm },
  { titulo: 'CST', largura: 26, alinhar: 'center', valor: (i) => i.cst },
  { titulo: 'CFOP', largura: 28, alinhar: 'center', valor: (i) => i.cfop },
  { titulo: 'Un', largura: 22, alinhar: 'center', valor: (i) => i.unidade },
  { titulo: 'Qtd', largura: 36, alinhar: 'right', valor: (i) => qtd(i.quantidade) },
  { titulo: 'Vl. unit', largura: 46, alinhar: 'right', valor: (i) => moeda(i.valorUnitario) },
  { titulo: 'Vl. total', largura: 50, alinhar: 'right', valor: (i) => moeda(i.valorTotal) },
  { titulo: 'BC ICMS', largura: 44, alinhar: 'right', valor: (i) => moeda(i.baseIcms) },
  { titulo: 'Vl. ICMS', largura: 44, alinhar: 'right', valor: (i) => moeda(i.valorIcms) },
  { titulo: '%', largura: 26, alinhar: 'right', valor: (i) => qtd(i.aliquotaIcms) },
];

function cabecalhoItens(doc: Doc, y: number): number {
  doc.rect(MARGEM, y, LARGURA, 12).stroke();
  let x = MARGEM;
  doc.fontSize(5.5).font('Helvetica-Bold');
  for (const c of COLUNAS) {
    doc.text(c.titulo.toUpperCase(), x + 2, y + 4, { width: c.largura - 4, align: c.alinhar });
    x += c.largura;
    if (x < MARGEM + LARGURA) doc.moveTo(x, y).lineTo(x, y + 12).stroke();
  }
  return y + 12;
}

function itens(doc: Doc, nota: NotaFiscalLida, y: number): number {
  doc.fontSize(6).font('Helvetica-Bold').text('DADOS DOS PRODUTOS / SERVIÇOS', MARGEM, y + 1);
  let yy = cabecalhoItens(doc, y + 9);
  const alturaLinha = 11;
  const limite = 812 - MARGEM; // rodapé da página A4

  for (const item of nota.itens) {
    if (yy + alturaLinha > limite) {
      doc.addPage();
      yy = cabecalhoItens(doc, MARGEM);
    }
    doc.rect(MARGEM, yy, LARGURA, alturaLinha).stroke();
    let x = MARGEM;
    doc.fontSize(5.5).font('Helvetica');
    for (const c of COLUNAS) {
      doc.text(c.valor(item), x + 2, yy + 3, { width: c.largura - 4, align: c.alinhar, ellipsis: true, lineBreak: false });
      x += c.largura;
      if (x < MARGEM + LARGURA) doc.moveTo(x, yy).lineTo(x, yy + alturaLinha).stroke();
    }
    yy += alturaLinha;
  }
  return yy + 4;
}

/**
 * Monta o DANFE em A4 retrato a partir do XML já lido. Não toca em banco nem
 * em HTTP — recebe objeto, devolve bytes; é o que permite testar o layout
 * chamando a função direto, sem subir servidor.
 */
export function renderizarDanfe(nota: NotaFiscalLida): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
    const pedacos: Buffer[] = [];
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);

    try {
      doc.lineWidth(0.5).strokeColor('#000');

      // Canhoto de recebimento
      let y = MARGEM;
      doc.rect(MARGEM, y, LARGURA - 70, 26).stroke();
      doc.fontSize(5.5).font('Helvetica').text(
        `RECEBEMOS DE ${nota.emitente.nome} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
        MARGEM + 4, y + 4, { width: LARGURA - 80 },
      );
      doc.fontSize(5).text('DATA DE RECEBIMENTO', MARGEM + 4, y + 16);
      doc.fontSize(5).text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', MARGEM + 110, y + 16);
      doc.moveTo(MARGEM + 104, y).lineTo(MARGEM + 104, y + 26).stroke();
      doc.rect(MARGEM + LARGURA - 70, y, 70, 26).stroke();
      doc.fontSize(7).font('Helvetica-Bold').text(`NF-e\nNº ${nota.numero}\nSÉRIE ${nota.serie}`, MARGEM + LARGURA - 68, y + 3, { width: 66, align: 'center' });
      y += 32;

      y = cabecalho(doc, nota, y);
      y += 4;
      y = parte(doc, 'Destinatário / Remetente', nota.destinatario, y, [
        ['Data de emissão', dataCurta(nota.emissaoEm)],
        ['Data de saída', dataCurta(nota.saidaEm)],
        ['Fone', nota.destinatario.fone ?? ''],
      ]);
      y = impostos(doc, nota, y);
      y = itens(doc, nota, y);

      if (nota.informacoesAdicionais) {
        campo(doc, MARGEM, y, LARGURA, 40, 'Informações complementares', nota.informacoesAdicionais, { tamanho: 6 });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
