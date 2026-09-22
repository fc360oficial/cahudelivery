import { XMLParser } from 'fast-xml-parser';

export interface EnderecoNfe {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
}

export interface ParteNfe {
  documento: string;
  tipoDocumento: 'CNPJ' | 'CPF';
  nome: string;
  ie: string | null;
  fone: string | null;
  endereco: EnderecoNfe;
}

export interface ItemNfe {
  numero: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cst: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  baseIcms: number;
  valorIcms: number;
  aliquotaIcms: number;
  valorIpi: number;
}

export interface TotaisNfe {
  baseIcms: number;
  valorIcms: number;
  valorProdutos: number;
  valorFrete: number;
  valorSeguro: number;
  valorDesconto: number;
  valorIpi: number;
  valorPis: number;
  valorCofins: number;
  valorOutros: number;
  valorTotal: number;
}

export interface NotaFiscalLida {
  chave: string;
  numero: string;
  serie: string;
  naturezaOperacao: string;
  emissaoEm: Date;
  saidaEm: Date | null;
  protocolo: string | null;
  emitente: ParteNfe;
  destinatario: ParteNfe;
  itens: ItemNfe[];
  totais: TotaisNfe;
  modalidadeFrete: string;
  informacoesAdicionais: string | null;
}

// Tudo como texto: valores monetários viram number só onde queremos, e códigos
// com zero à esquerda (série, CST, NCM) não podem ser convertidos para número.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const texto = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const numero = (v: unknown): number => {
  const n = Number(texto(v));
  return Number.isFinite(n) ? n : 0;
};
const ouNulo = (v: unknown): string | null => {
  const s = texto(v);
  return s === '' ? null : s;
};
const data = (v: unknown): Date | null => {
  const s = texto(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** fast-xml-parser devolve objeto quando há 1 ocorrência e array quando há várias. */
const lista = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function lerEndereco(e: Record<string, unknown> | undefined): EnderecoNfe {
  const end = e ?? {};
  return {
    logradouro: texto(end.xLgr),
    numero: texto(end.nro),
    bairro: texto(end.xBairro),
    municipio: texto(end.xMun),
    codigoMunicipio: texto(end.cMun),
    uf: texto(end.UF),
    cep: texto(end.CEP),
  };
}

function lerParte(p: Record<string, unknown> | undefined, chaveEndereco: string): ParteNfe {
  const parte = p ?? {};
  const cnpj = ouNulo(parte.CNPJ);
  return {
    documento: cnpj ?? texto(parte.CPF),
    tipoDocumento: cnpj ? 'CNPJ' : 'CPF',
    nome: texto(parte.xNome),
    ie: ouNulo(parte.IE),
    fone: ouNulo((parte[chaveEndereco] as Record<string, unknown>)?.fone),
    endereco: lerEndereco(parte[chaveEndereco] as Record<string, unknown>),
  };
}

function lerItem(det: Record<string, unknown>): ItemNfe {
  const prod = (det.prod ?? {}) as Record<string, unknown>;
  const imposto = (det.imposto ?? {}) as Record<string, unknown>;
  // O ICMS vem dentro de um filho cujo nome varia com a tributação
  // (ICMS00, ICMS20, ICMSSN102...). Pegar o primeiro filho evita listar todos.
  const icmsRaiz = (imposto.ICMS ?? {}) as Record<string, unknown>;
  const icms = (Object.values(icmsRaiz)[0] ?? {}) as Record<string, unknown>;
  const ipi = ((imposto.IPI ?? {}) as Record<string, unknown>).IPITrib as Record<string, unknown> | undefined;
  return {
    numero: numero(det['@nItem']),
    codigo: texto(prod.cProd),
    descricao: texto(prod.xProd),
    ncm: texto(prod.NCM),
    cst: texto(icms.CST ?? icms.CSOSN),
    cfop: texto(prod.CFOP),
    unidade: texto(prod.uCom),
    quantidade: numero(prod.qCom),
    valorUnitario: numero(prod.vUnCom),
    valorTotal: numero(prod.vProd),
    baseIcms: numero(icms.vBC),
    valorIcms: numero(icms.vICMS),
    aliquotaIcms: numero(icms.pICMS),
    valorIpi: numero(ipi?.vIPI),
  };
}

export function lerNfe(xml: string): NotaFiscalLida {
  const raiz = parser.parse(xml) as Record<string, any>;
  // O Dlinks manda nfeProc (nota + protocolo); aceitar NFe solta também.
  const nfe = raiz?.nfeProc?.NFe ?? raiz?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('XML sem infNFe');

  const ide = (inf.ide ?? {}) as Record<string, unknown>;
  const total = ((inf.total ?? {}) as Record<string, unknown>).ICMSTot as Record<string, unknown> | undefined;
  const tot = total ?? {};
  const infProt = raiz?.nfeProc?.protNFe?.infProt as Record<string, unknown> | undefined;

  return {
    // O Id vem como "NFe26260..." — a chave são os 44 dígitos depois do prefixo.
    chave: texto(inf['@Id']).replace(/^NFe/, ''),
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    naturezaOperacao: texto(ide.natOp),
    emissaoEm: data(ide.dhEmi) ?? new Date(0),
    saidaEm: data(ide.dhSaiEnt),
    protocolo: ouNulo(infProt?.nProt),
    emitente: lerParte(inf.emit, 'enderEmit'),
    destinatario: lerParte(inf.dest, 'enderDest'),
    itens: lista<Record<string, unknown>>(inf.det).map(lerItem),
    totais: {
      baseIcms: numero(tot.vBC),
      valorIcms: numero(tot.vICMS),
      valorProdutos: numero(tot.vProd),
      valorFrete: numero(tot.vFrete),
      valorSeguro: numero(tot.vSeg),
      valorDesconto: numero(tot.vDesc),
      valorIpi: numero(tot.vIPI),
      valorPis: numero(tot.vPIS),
      valorCofins: numero(tot.vCOFINS),
      valorOutros: numero(tot.vOutro),
      valorTotal: numero(tot.vNF),
    },
    modalidadeFrete: texto(((inf.transp ?? {}) as Record<string, unknown>).modFrete),
    informacoesAdicionais: ouNulo(((inf.infAdic ?? {}) as Record<string, unknown>).infCpl),
  };
}
