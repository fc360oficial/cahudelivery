import { describe, expect, it } from 'vitest';
import { decidirAposIncerto, MARGEM_RELOGIO_MS } from './incerto';

const INICIO = Date.parse('2026-11-13T15:00:00.000Z');
const ID_NOVO = '0b6f3a52-9c1d-4e7a-8f20-5d4c3b2a1908';
const ID_VELHO = '7ea763be-1111-4e7a-8f20-5d4c3b2a1908';
const pedido = (id: string, criadoEm: string | null) => ({ id, criadoEm });

describe('decidirAposIncerto (envio sem resposta: o pedido foi criado?)', () => {
  it('pedido criado depois do início do envio: leva o cliente a ele (mesmo com o carrinho ainda carregando)', () => {
    expect(decidirAposIncerto({
      itensNoCarrinho: null,
      pedidos: [pedido(ID_NOVO, '2026-11-13T15:00:04.000Z'), pedido(ID_VELHO, '2026-11-10T10:00:00.000Z')],
      inicioEnvio: INICIO,
    })).toEqual({ acao: 'ir-ao-pedido', id: ID_NOVO });
  });

  it('tolera relógio do navegador um pouco adiantado (pedido com criado_em até a margem antes do envio)', () => {
    const quase = new Date(INICIO - MARGEM_RELOGIO_MS + 1000).toISOString();
    expect(decidirAposIncerto({ itensNoCarrinho: 0, pedidos: [pedido(ID_NOVO, quase)], inicioEnvio: INICIO }))
      .toEqual({ acao: 'ir-ao-pedido', id: ID_NOVO });
  });

  it('pedido antigo não conta; carrinho vazio sem pedido novo: Meus pedidos com aviso', () => {
    expect(decidirAposIncerto({ itensNoCarrinho: 0, pedidos: [pedido(ID_VELHO, '2026-11-10T10:00:00.000Z')], inicioEnvio: INICIO }))
      .toEqual({ acao: 'meus-pedidos' });
    expect(decidirAposIncerto({ itensNoCarrinho: 0, pedidos: null, inicioEnvio: INICIO })).toEqual({ acao: 'meus-pedidos' });
  });

  it('carrinho continua com os itens e nenhum pedido novo: libera nova tentativa', () => {
    expect(decidirAposIncerto({ itensNoCarrinho: 3, pedidos: [], inicioEnvio: INICIO })).toEqual({ acao: 'liberar' });
    expect(decidirAposIncerto({ itensNoCarrinho: 3, pedidos: null, inicioEnvio: INICIO })).toEqual({ acao: 'liberar' });
  });

  it('não deu para ler o carrinho nem achar pedido novo: continua travado (indeterminado)', () => {
    expect(decidirAposIncerto({ itensNoCarrinho: null, pedidos: [], inicioEnvio: INICIO })).toEqual({ acao: 'indeterminado' });
    expect(decidirAposIncerto({ itensNoCarrinho: null, pedidos: null, inicioEnvio: INICIO })).toEqual({ acao: 'indeterminado' });
  });

  it('ignora pedido sem data, com data inválida ou com id fora do formato', () => {
    const r = decidirAposIncerto({
      itensNoCarrinho: 2,
      pedidos: [pedido(ID_NOVO, null), pedido(ID_NOVO, 'ontem'), pedido('../admin', '2026-11-13T15:00:04.000Z')],
      inicioEnvio: INICIO,
    });
    expect(r).toEqual({ acao: 'liberar' });
  });

  it('com mais de um pedido novo, vai ao mais recente', () => {
    const outro = '1a2b3c4d-9c1d-4e7a-8f20-5d4c3b2a1908';
    expect(decidirAposIncerto({
      itensNoCarrinho: 0,
      pedidos: [pedido(ID_NOVO, '2026-11-13T15:00:04.000Z'), pedido(outro, '2026-11-13T15:00:09.000Z')],
      inicioEnvio: INICIO,
    })).toEqual({ acao: 'ir-ao-pedido', id: outro });
  });
});
