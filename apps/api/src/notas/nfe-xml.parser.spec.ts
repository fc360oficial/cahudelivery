import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe } from './nfe-xml.parser';

const XML = readFileSync(join(__dirname, 'fixtures', 'nfe-5060.xml'), 'utf8');

describe('lerNfe', () => {
  const nota = lerNfe(XML);

  it('lê identificação, tirando o prefixo NFe da chave', () => {
    expect(nota.chave).toBe('26260961920643000148550030000050601000073367');
    expect(nota.chave).toHaveLength(44);
    expect(nota.numero).toBe('5060');
    expect(nota.serie).toBe('3');
    expect(nota.naturezaOperacao).toBe('VENDA');
    expect(nota.protocolo).toBe('126260114685548');
  });

  it('lê o emitente com endereço', () => {
    expect(nota.emitente.documento).toBe('61920643000148');
    expect(nota.emitente.nome).toBe('CAHU DISTRIBUIDORA DE ALIMENTOS LTD');
    expect(nota.emitente.ie).toBe('126480516');
    expect(nota.emitente.endereco.municipio).toBe('RECIFE');
    expect(nota.emitente.endereco.uf).toBe('PE');
    expect(nota.emitente.endereco.cep).toBe('54320080');
  });

  it('lê o destinatário', () => {
    expect(nota.destinatario.documento).toBe('21425302000181');
    expect(nota.destinatario.tipoDocumento).toBe('CNPJ');
    expect(nota.destinatario.endereco.municipio).toBe('JABOATAO DOS GUARARAPES');
  });

  it('lê os itens', () => {
    expect(nota.itens).toHaveLength(1);
    const i = nota.itens[0];
    expect(i.numero).toBe(1);
    expect(i.codigo).toBe('7891008367027');
    expect(i.descricao).toBe('BATON GAROTO CASH 30UN CHOCOLATE AO LEIT');
    expect(i.ncm).toBe('18063210');
    expect(i.cfop).toBe('5102');
    expect(i.unidade).toBe('UN');
    expect(i.quantidade).toBe(6);
    expect(i.valorUnitario).toBe(39);
    expect(i.valorTotal).toBe(234);
    expect(i.aliquotaIcms).toBe(20.5);
    expect(i.valorIcms).toBe(47.97);
  });

  it('lê os totais', () => {
    expect(nota.totais.valorProdutos).toBe(234);
    expect(nota.totais.valorTotal).toBe(234);
    expect(nota.totais.valorIcms).toBe(47.97);
    expect(nota.totais.valorDesconto).toBe(0);
    expect(nota.totais.valorFrete).toBe(0);
  });

  it('não quebra com os campos IBS/CBS da reforma tributária', () => {
    // O XML tem IBSCBS/gIBSCBS/vNFTot (NT 2025). O parser ignora, mas não pode
    // engasgar — foi por isso que as libs prontas de DANFE foram descartadas.
    expect(XML).toContain('IBSCBS');
    expect(nota.totais.valorTotal).toBe(234);
  });

  it('tolera o bloco Signature quando ele vem no XML', () => {
    const comAssinatura = XML.replace(
      '</infNFe>',
      '</infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
        '<SignedInfo><Reference URI="#NFe26"><DigestValue>abc=</DigestValue></Reference></SignedInfo>' +
        '<SignatureValue>zzz=</SignatureValue></Signature>',
    );
    expect(lerNfe(comAssinatura).chave).toBe(nota.chave);
    expect(lerNfe(comAssinatura).itens).toHaveLength(1);
  });

  it('trata nota com um único item e com vários da mesma forma', () => {
    // fast-xml-parser devolve objeto quando há 1 <det> e array quando há vários.
    const doisItens = XML.replace(
      /<det nItem="1">([\s\S]*?)<\/det>/,
      (m, corpo) => `${m}<det nItem="2">${corpo}</det>`,
    );
    expect(lerNfe(doisItens).itens).toHaveLength(2);
  });

  it('rejeita XML sem infNFe', () => {
    expect(() => lerNfe('<nfeProc><nada/></nfeProc>')).toThrow('XML sem infNFe');
  });
});
