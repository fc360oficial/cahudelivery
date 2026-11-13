import { describe, expect, it } from 'vitest';
import { normalizarPedidoCriado, validarPedido } from './pedido';

const END = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';
const CONDICOES = ['À vista', '30 dias'];

describe('validarPedido (corpo do navegador → CriarPedidoDto, só ids e escolhas)', () => {
  it('entrega com endereço, PIX, observações aparadas e uso do saldo', () => {
    expect(validarPedido({ tipoEntrega: 'entrega', enderecoId: END, formaPagamento: 'pix', observacoes: '  manhã  ', usarSaldo: true }, CONDICOES))
      .toEqual({ tipoEntrega: 'entrega', enderecoId: END, formaPagamento: 'pix', observacoes: 'manhã', usarSaldo: true });
  });

  it('retirada não manda endereço (mesmo se vier) nem campos vazios', () => {
    expect(validarPedido({ tipoEntrega: 'retirada', enderecoId: END, formaPagamento: 'cartao', observacoes: '   ', usarSaldo: false }, CONDICOES))
      .toEqual({ tipoEntrega: 'retirada', formaPagamento: 'cartao' });
  });

  it('boleto leva a condição escolhida, que precisa estar entre as da retaguarda', () => {
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'boleto', condicaoPagamento: '30 dias' }, CONDICOES))
      .toEqual({ tipoEntrega: 'retirada', formaPagamento: 'boleto', condicaoPagamento: '30 dias' });
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'boleto', condicaoPagamento: '360 dias' }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'boleto' }, CONDICOES)).toBeNull();
  });

  it('condição de boleto em outra forma é descartada', () => {
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'pix', condicaoPagamento: '30 dias' }, CONDICOES))
      .toEqual({ tipoEntrega: 'retirada', formaPagamento: 'pix' });
  });

  it('nunca repassa preço, total, itens ou outro campo que o navegador mande', () => {
    const r = validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'pix', total: 1, preco: 1, itens: [], subtotal: 0, clienteId: END }, CONDICOES);
    expect(r).toEqual({ tipoEntrega: 'retirada', formaPagamento: 'pix' });
  });

  it('recusa o que não serve', () => {
    expect(validarPedido(null, CONDICOES)).toBeNull();
    expect(validarPedido([], CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'entrega', formaPagamento: 'pix' }, CONDICOES)).toBeNull(); // sem endereço
    expect(validarPedido({ tipoEntrega: 'entrega', enderecoId: 'x', formaPagamento: 'pix' }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'drone', formaPagamento: 'pix' }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'dinheiro' }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'pix', usarSaldo: 'sim' }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'pix', observacoes: 'x'.repeat(501) }, CONDICOES)).toBeNull();
    expect(validarPedido({ tipoEntrega: 'retirada', formaPagamento: 'pix', observacoes: 5 }, CONDICOES)).toBeNull();
  });
});

describe('normalizarPedidoCriado', () => {
  it('só id, número, status e a situação do pagamento (sem copia-e-cola nem dados do provedor)', () => {
    expect(normalizarPedidoCriado({
      id: END, numero: 17, status: 'AGUARDANDO_PAGAMENTO', criado_em: '2026-11-13T14:20:47Z',
      pagamento: { id: 'p1', metodo: 'pix', status: 'pendente', copiaCola: '000201…', provedor_ref: 'r' },
    })).toEqual({ id: END, numero: '17', status: 'AGUARDANDO_PAGAMENTO', pagamento: { metodo: 'pix', status: 'pendente' } });
    expect(normalizarPedidoCriado({ id: END, numero: '18', status: 'RECEBIDO', pagamento: null }))
      .toEqual({ id: END, numero: '18', status: 'RECEBIDO', pagamento: null });
  });

  it('id que não é uuid vira nulo (a tela não navega para lugar estranho)', () => {
    expect(normalizarPedidoCriado({ id: '../x', numero: 1, status: 'RECEBIDO' })).toBeNull();
  });
});
