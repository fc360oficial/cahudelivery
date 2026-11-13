import { describe, expect, it } from 'vitest';
import {
  normalizarCarteira, normalizarCredito, normalizarEndereco, normalizarPaginaNotas, normalizarPaginaPedidos,
  normalizarPedidoDetalhe, normalizarPerfil,
} from './normalizar-conta';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';
const PROD = '11111111-1111-4111-8111-111111111111';

describe('normalizarPerfil', () => {
  it('campos do GET perfil, sem id', () => {
    const p = normalizarPerfil({
      id: ID, tipo: 'CNPJ', documento: '11222333000181', razao_social: 'Mercearia LTDA', nome_fantasia: 'Mercearia',
      email: 'a@b.com', telefone: '81999990000', status: 'aprovado',
    });
    expect(p).toEqual({
      tipo: 'CNPJ', documento: '11222333000181', razaoSocial: 'Mercearia LTDA', nomeFantasia: 'Mercearia',
      email: 'a@b.com', telefone: '81999990000', status: 'aprovado',
    });
    expect(p).not.toHaveProperty('id');
  });
  it('ausentes viram nulo', () => {
    expect(normalizarPerfil({ documento: '1', nome_fantasia: 'X' })).toMatchObject({ tipo: null, razaoSocial: null, email: null, telefone: null, status: null });
  });
});

describe('normalizarEndereco', () => {
  it('só os campos de endereço (sem cliente_id, geocodificação, código de município)', () => {
    const e = normalizarEndereco({
      id: ID, cliente_id: 'outro', apelido: null, cep: '50000000', logradouro: 'Rua A', numero: '1', complemento: null,
      bairro: 'Centro', cidade: 'Recife', uf: 'PE', padrao: true, latitude: '-8.0', codigo_municipio: '2611606',
    });
    expect(e).toEqual({
      id: ID, apelido: null, cep: '50000000', logradouro: 'Rua A', numero: '1', complemento: null,
      bairro: 'Centro', cidade: 'Recife', uf: 'PE', padrao: true,
    });
  });
});

describe('normalizarPaginaPedidos', () => {
  const linha = (n: number) => ({
    id: ID, numero: String(n), status: 'RECEBIDO', forma_pagamento: 'boleto', total: '152.40', criado_em: '2026-11-10T12:00:00.000Z',
    pagamento: null,
  });
  it('total numeric em string vira número; temMais quando veio página cheia (20)', () => {
    const r = normalizarPaginaPedidos({ dados: Array.from({ length: 20 }, (_, i) => linha(i)), pagina: 1 });
    expect(r.temMais).toBe(true);
    expect(r.dados[0]).toEqual({
      id: ID, numero: '0', status: 'RECEBIDO', formaPagamento: 'boleto', total: 152.4, criadoEm: '2026-11-10T12:00:00.000Z', pagamento: null,
    });
    expect(normalizarPaginaPedidos({ dados: [linha(1)], pagina: 2 })).toMatchObject({ pagina: 2, temMais: false });
  });
  it('pagamento online sem o copia-e-cola (pagamento pelo site é outra etapa)', () => {
    const r = normalizarPaginaPedidos({
      dados: [{ ...linha(1), status: 'AGUARDANDO_PAGAMENTO', pagamento: { id: 'x', metodo: 'pix', status: 'pendente', valor: '10.00', copiaCola: '000201...', expiraEm: '2026-11-10T13:00:00Z', pagoEm: null } }],
      pagina: 1,
    });
    expect(r.dados[0].pagamento).toEqual({ metodo: 'pix', status: 'pendente', valor: 10, expiraEm: '2026-11-10T13:00:00Z', pagoEm: null });
  });
  it('corpo estranho vira lista vazia', () => {
    expect(normalizarPaginaPedidos({})).toEqual({ dados: [], pagina: 1, temMais: false });
  });
});

describe('normalizarPedidoDetalhe', () => {
  const bruto = {
    id: ID, numero: '42', cliente_id: 'c', status: 'FATURADO', forma_pagamento: 'boleto', condicao_pagamento: '28 dias',
    tipo_entrega: 'entrega', subtotal: '100.00', desconto: '0', valor_saldo_usado: '5.00', total: '95.00',
    observacoes: 'Entregar de manhã', criado_em: '2026-11-10T12:00:00.000Z', erp_pedido_id: 'ERP-1', aceite_json: { ip: '1.2.3.4' },
    endereco_snapshot_json: { id: 'e', cliente_id: 'c', cep: '50000000', logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
    itens: [{ produtoId: PROD, descricao: 'Arroz 5 kg', quantidade: '2', precoUnit: '25.50', total: '51.00' }],
    eventos: [{ status: 'RECEBIDO', detalhe: 'Pedido recebido', em: '2026-11-10T12:00:00.000Z' }],
    cobranca: { pedido_id: ID, tipo: 'boleto', linha_digitavel: '34191.79001 01043.510047', pix_copia_cola: null, pdf_url: 'https://banco/x.pdf', valor: '95.00', vencimento: '2026-12-08', pago_em: null },
    nota: { pedido_id: ID, numero_nf: '1234', chave_acesso: '2'.repeat(44), xml_url: 'https://api/v1/notas/x', pdf_url: 'https://api/v1/notas/y', emitida_em: '2026-11-11T10:00:00.000Z', serie: '1' },
    pagamento: null,
  };
  it('números, endereço, itens, linha do tempo e nota', () => {
    const p = normalizarPedidoDetalhe(bruto);
    expect(p).toMatchObject({
      id: ID, numero: '42', status: 'FATURADO', formaPagamento: 'boleto', condicaoPagamento: '28 dias', tipoEntrega: 'entrega',
      subtotal: 100, desconto: 0, saldoUsado: 5, total: 95, observacoes: 'Entregar de manhã',
      endereco: { cep: '50000000', logradouro: 'Rua A', numero: '1', complemento: null, bairro: 'Centro', cidade: 'Recife', uf: 'PE' },
      itens: [{ produtoId: PROD, descricao: 'Arroz 5 kg', quantidade: 2, precoUnit: 25.5, total: 51, imagemUrl: null }],
      eventos: [{ status: 'RECEBIDO', detalhe: 'Pedido recebido', em: '2026-11-10T12:00:00.000Z' }],
      cobranca: { tipo: 'boleto', valor: 95, vencimento: '2026-12-08', pagoEm: null, linhaDigitavel: '34191.79001 01043.510047' },
      nota: { numero: '1234', chaveAcesso: '2'.repeat(44), emitidaEm: '2026-11-11T10:00:00.000Z', temDanfe: true, temXml: true },
    });
  });
  it('não devolve ao navegador as URLs assinadas, colunas internas nem o aceite', () => {
    const texto = JSON.stringify(normalizarPedidoDetalhe(bruto));
    for (const proibido of ['https://api', 'https://banco', 'erp_pedido_id', 'ERP-1', '1.2.3.4', 'cliente_id', 'pix_copia_cola']) {
      expect(texto).not.toContain(proibido);
    }
  });
  it('retirada sem endereço; sem itens/eventos/nota', () => {
    const p = normalizarPedidoDetalhe({ ...bruto, tipo_entrega: 'retirada', endereco_snapshot_json: null, itens: null, eventos: null, nota: null, cobranca: null });
    expect(p).toMatchObject({ tipoEntrega: 'retirada', endereco: null, itens: [], eventos: [], nota: null, cobranca: null });
  });
});

describe('normalizarPaginaNotas', () => {
  it('nota com flags de arquivo no lugar das URLs', () => {
    const r = normalizarPaginaNotas({
      dados: [{ pedido_id: ID, numero: '42', total: '95.00', numero_nf: '1234', chave_acesso: null, pdf_url: 'https://api/x', xml_url: null, emitida_em: '2026-11-11T10:00:00.000Z' }],
      pagina: 1,
    });
    expect(r).toEqual({
      dados: [{ pedidoId: ID, numeroPedido: '42', total: 95, numero: '1234', chaveAcesso: null, emitidaEm: '2026-11-11T10:00:00.000Z', temDanfe: true, temXml: false }],
      pagina: 1,
      temMais: false,
    });
    expect(JSON.stringify(r)).not.toContain('https://');
  });
});

describe('carteira e crédito', () => {
  it('saldo e movimentos com valor numérico', () => {
    expect(normalizarCarteira({ saldo: 12.5, movimentos: [{ id: ID, valor: '-5.00', motivo: 'Uso no pedido #3', criado_em: '2026-11-10T12:00:00Z' }] }))
      .toEqual({ saldo: 12.5, movimentos: [{ id: ID, valor: -5, motivo: 'Uso no pedido #3', criadoEm: '2026-11-10T12:00:00Z' }] });
    expect(normalizarCarteira({})).toEqual({ saldo: 0, movimentos: [] });
  });
  it('crédito: só o que a API devolve (pendente)', () => {
    expect(normalizarCredito({ pendente: true })).toEqual({ pendente: true });
    expect(normalizarCredito({})).toEqual({ pendente: false });
  });
});
