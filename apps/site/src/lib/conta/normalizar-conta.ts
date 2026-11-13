import type {
  Carteira, Cobranca, Credito, Endereco, EnderecoEntrega, EventoPedido, ItemPedido, NotaFiscal, NotaPedido, Pagina,
  PagamentoOnline, PedidoDetalhe, PedidoResumo, Perfil,
} from './tipos';

/**
 * Respostas da API (/perfil, /pedidos, /carteira…) → formato do site. Cada função copia só os
 * campos que a tela usa: colunas internas, URLs assinadas e dados de outros sistemas nunca
 * chegam ao navegador. `numeric` do Postgres chega como string: sempre vira número aqui.
 */

type Bruto = Record<string, unknown>;

/** A API pagina pedidos e notas de 20 em 20 (orders.service.ts). */
export const POR_PAGINA_API = 20;

const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown, padrao = 0): number => numOuNulo(v) ?? padrao;
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const obj = (v: unknown): Bruto | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : null);
const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Bruto => x !== null) : []);
/** Datas chegam como string ISO (JSON) — qualquer outra coisa vira nulo. */
const data = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function normalizarPerfil(b: Bruto): Perfil {
  return {
    tipo: b.tipo === 'CPF' || b.tipo === 'CNPJ' ? b.tipo : null,
    documento: str(b.documento),
    razaoSocial: txt(b.razao_social),
    nomeFantasia: str(b.nome_fantasia),
    email: txt(b.email),
    telefone: txt(b.telefone),
    status: txt(b.status),
  };
}

export function normalizarEndereco(b: Bruto): Endereco {
  return {
    id: str(b.id),
    apelido: txt(b.apelido),
    cep: str(b.cep),
    logradouro: str(b.logradouro),
    numero: str(b.numero),
    complemento: txt(b.complemento),
    bairro: str(b.bairro),
    cidade: str(b.cidade),
    uf: str(b.uf).trim(),
    padrao: b.padrao === true,
  };
}

export function normalizarEnderecos(v: unknown): Endereco[] {
  return lista(v).map(normalizarEndereco);
}

function enderecoEntrega(v: unknown): EnderecoEntrega | null {
  const b = obj(v);
  if (!b) return null;
  return {
    cep: str(b.cep), logradouro: str(b.logradouro), numero: str(b.numero), complemento: txt(b.complemento),
    bairro: str(b.bairro), cidade: str(b.cidade), uf: str(b.uf).trim(),
  };
}

function pagamentoOnline(v: unknown): PagamentoOnline | null {
  const b = obj(v);
  if (!b) return null;
  return { metodo: txt(b.metodo), status: txt(b.status), valor: numOuNulo(b.valor), expiraEm: data(b.expiraEm), pagoEm: data(b.pagoEm) };
}

function pedidoResumo(b: Bruto): PedidoResumo {
  return {
    id: str(b.id),
    numero: str(b.numero),
    status: str(b.status),
    formaPagamento: txt(b.forma_pagamento),
    total: num(b.total),
    criadoEm: data(b.criado_em),
    pagamento: pagamentoOnline(b.pagamento),
  };
}

function pagina<T>(b: Bruto, mapa: (x: Bruto) => T): Pagina<T> {
  const brutos = lista(b.dados);
  const p = num(b.pagina, 1);
  return { dados: brutos.map(mapa), pagina: p >= 1 ? p : 1, temMais: brutos.length >= POR_PAGINA_API };
}

export function normalizarPaginaPedidos(b: Bruto): Pagina<PedidoResumo> {
  return pagina(b, pedidoResumo);
}

function item(b: Bruto): ItemPedido {
  return {
    produtoId: txt(b.produtoId),
    descricao: str(b.descricao),
    quantidade: num(b.quantidade),
    precoUnit: numOuNulo(b.precoUnit),
    total: numOuNulo(b.total),
    imagemUrl: null,
  };
}

function evento(b: Bruto): EventoPedido {
  return { status: str(b.status), detalhe: txt(b.detalhe), em: data(b.em) };
}

function cobranca(v: unknown): Cobranca | null {
  const b = obj(v);
  if (!b) return null;
  return {
    tipo: txt(b.tipo), valor: numOuNulo(b.valor), vencimento: data(b.vencimento), pagoEm: data(b.pago_em),
    linhaDigitavel: txt(b.linha_digitavel),
  };
}

function notaPedido(v: unknown): NotaPedido | null {
  const b = obj(v);
  if (!b) return null;
  return {
    numero: str(b.numero_nf),
    chaveAcesso: txt(b.chave_acesso),
    emitidaEm: data(b.emitida_em),
    temDanfe: !!txt(b.pdf_url),
    temXml: !!txt(b.xml_url),
  };
}

export function normalizarPedidoDetalhe(b: Bruto): PedidoDetalhe {
  return {
    id: str(b.id),
    numero: str(b.numero),
    status: str(b.status),
    formaPagamento: txt(b.forma_pagamento),
    condicaoPagamento: txt(b.condicao_pagamento),
    tipoEntrega: b.tipo_entrega === 'retirada' ? 'retirada' : 'entrega',
    subtotal: num(b.subtotal),
    desconto: num(b.desconto),
    saldoUsado: num(b.valor_saldo_usado),
    total: num(b.total),
    observacoes: txt(b.observacoes),
    criadoEm: data(b.criado_em),
    endereco: enderecoEntrega(b.endereco_snapshot_json),
    itens: lista(b.itens).map(item),
    eventos: lista(b.eventos).map(evento),
    cobranca: cobranca(b.cobranca),
    nota: notaPedido(b.nota),
    pagamento: pagamentoOnline(b.pagamento),
  };
}

function notaFiscal(b: Bruto): NotaFiscal {
  return {
    pedidoId: str(b.pedido_id),
    numeroPedido: str(b.numero),
    total: num(b.total),
    numero: str(b.numero_nf),
    chaveAcesso: txt(b.chave_acesso),
    emitidaEm: data(b.emitida_em),
    temDanfe: !!txt(b.pdf_url),
    temXml: !!txt(b.xml_url),
  };
}

export function normalizarPaginaNotas(b: Bruto): Pagina<NotaFiscal> {
  return pagina(b, notaFiscal);
}

export function normalizarCarteira(b: Bruto): Carteira {
  return {
    saldo: num(b.saldo),
    movimentos: lista(b.movimentos).map((m) => ({
      id: str(m.id), valor: num(m.valor), motivo: str(m.motivo), criadoEm: data(m.criado_em),
    })),
  };
}

export function normalizarCredito(b: Bruto): Credito {
  return { pendente: b.pendente === true };
}
