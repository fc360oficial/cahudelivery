import { describe, expect, it } from 'vitest';
import {
  aguardaPagamento, rotuloFormaPagamento, situacaoCadastro, statusPagamentoOnline, statusPedido,
} from './status';

describe('statusPedido', () => {
  it('mesmos nomes do app', () => {
    expect(statusPedido('AGUARDANDO_PAGAMENTO')).toEqual({ rotulo: 'Aguardando pagamento', tom: 'alerta' });
    expect(statusPedido('RECEBIDO')).toEqual({ rotulo: 'Recebido', tom: 'andamento' });
    expect(statusPedido('ENVIADO_ERP').rotulo).toBe('Em processamento');
    expect(statusPedido('ABERTO').rotulo).toBe('Em processamento');
    expect(statusPedido('EM_FATURAMENTO').rotulo).toBe('Em faturamento');
    expect(statusPedido('FATURADO').rotulo).toBe('Faturado');
    expect(statusPedido('EM_SEPARACAO').rotulo).toBe('Em separação');
    expect(statusPedido('SAIU_ENTREGA').rotulo).toBe('Saiu para entrega');
    expect(statusPedido('ENTREGUE')).toEqual({ rotulo: 'Entregue', tom: 'positivo' });
    expect(statusPedido('CANCELADO')).toEqual({ rotulo: 'Cancelado', tom: 'perigo' });
  });
  it('falha de integração aparece ao cliente como em processamento', () => {
    expect(statusPedido('FALHA_INTEGRACAO')).toEqual({ rotulo: 'Em processamento', tom: 'andamento' });
  });
  it('desconhecido mostra o próprio texto, neutro', () => {
    expect(statusPedido('NOVO_STATUS')).toEqual({ rotulo: 'NOVO_STATUS', tom: 'neutro' });
    expect(statusPedido(null)).toEqual({ rotulo: '—', tom: 'neutro' });
  });
});

describe('aguardaPagamento', () => {
  it('só no AGUARDANDO_PAGAMENTO', () => {
    expect(aguardaPagamento('AGUARDANDO_PAGAMENTO')).toBe(true);
    expect(aguardaPagamento('RECEBIDO')).toBe(false);
  });
});

describe('situacaoCadastro', () => {
  it('rótulo e cor', () => {
    expect(situacaoCadastro('aprovado')).toEqual({ rotulo: 'Aprovado', tom: 'positivo' });
    expect(situacaoCadastro('pendente')).toEqual({ rotulo: 'Em análise', tom: 'alerta' });
    expect(situacaoCadastro('bloqueado')).toEqual({ rotulo: 'Bloqueado', tom: 'perigo' });
    expect(situacaoCadastro('ativo')).toEqual({ rotulo: 'Aprovado', tom: 'positivo' });
    expect(situacaoCadastro(null)).toEqual({ rotulo: '—', tom: 'neutro' });
  });
});

describe('rotuloFormaPagamento', () => {
  it('nomes das formas', () => {
    expect(rotuloFormaPagamento('boleto')).toBe('Boleto');
    expect(rotuloFormaPagamento('pix')).toBe('PIX');
    expect(rotuloFormaPagamento('cartao')).toBe('Cartão');
    expect(rotuloFormaPagamento(null)).toBe('—');
  });
});

describe('statusPagamentoOnline', () => {
  it('estados do pagamento', () => {
    expect(statusPagamentoOnline('pendente')).toEqual({ rotulo: 'Aguardando pagamento', tom: 'alerta' });
    expect(statusPagamentoOnline('pago')).toEqual({ rotulo: 'Pago', tom: 'positivo' });
    expect(statusPagamentoOnline('autorizado')).toEqual({ rotulo: 'Pago', tom: 'positivo' });
    expect(statusPagamentoOnline('expirado')).toEqual({ rotulo: 'Expirado', tom: 'perigo' });
    expect(statusPagamentoOnline('estornado').rotulo).toBe('Estornado');
    expect(statusPagamentoOnline('xyz')).toEqual({ rotulo: 'xyz', tom: 'neutro' });
  });
});
