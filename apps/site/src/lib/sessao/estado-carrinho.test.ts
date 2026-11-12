import { describe, expect, it } from 'vitest';
import { deveAplicarLeitura, interpretarRespostaMutacao } from './estado-carrinho';

describe('deveAplicarLeitura', () => {
  it('aplica quando nenhuma mutação terminou depois do início da leitura', () => {
    expect(deveAplicarLeitura(3, 3)).toBe(true);
  });
  it('descarta quando uma mutação terminou depois do início da leitura', () => {
    expect(deveAplicarLeitura(3, 4)).toBe(false);
  });
});

describe('interpretarRespostaMutacao', () => {
  const carrinho = { itens: [], subtotal: 0 };
  it('resposta OK devolve o carrinho', () => {
    expect(interpretarRespostaMutacao(true, JSON.stringify(carrinho))).toEqual({ carrinho });
  });
  it('erro com mensagem JSON devolve a mensagem', () => {
    expect(interpretarRespostaMutacao(false, JSON.stringify({ mensagem: 'Item indisponível.' }))).toEqual({ erro: 'Item indisponível.' });
  });
  it('erro com corpo HTML devolve mensagem genérica de servidor', () => {
    const r = interpretarRespostaMutacao(false, '<html>502 Bad Gateway</html>');
    expect(r).toEqual({ erro: 'O servidor não respondeu direito. Tente novamente.' });
  });
  it('OK com corpo inválido devolve erro genérico', () => {
    expect(interpretarRespostaMutacao(true, '<html>')).toEqual({ erro: 'O servidor não respondeu direito. Tente novamente.' });
  });
  it('OK com corpo null ou sem lista de itens devolve erro de servidor', () => {
    expect(interpretarRespostaMutacao(true, 'null')).toEqual({ erro: 'O servidor não respondeu direito. Tente novamente.' });
    expect(interpretarRespostaMutacao(true, '{}')).toEqual({ erro: 'O servidor não respondeu direito. Tente novamente.' });
  });
  it('erro JSON sem mensagem devolve texto padrão', () => {
    expect(interpretarRespostaMutacao(false, '{}')).toEqual({ erro: 'Não foi possível atualizar o carrinho.' });
  });
});
