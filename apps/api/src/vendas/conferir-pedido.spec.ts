import { arredondar, conferirPedido, DadosAtuais } from './conferir-pedido';

function dados(parcial: Partial<DadosAtuais> = {}): DadosAtuais {
  return {
    precos: new Map([
      ['p1', 86.4],
      ['p2', 31],
    ]),
    estoques: new Map([
      ['p1', 100],
      ['p2', 100],
    ]),
    nomes: new Map([
      ['p1', 'Margarina'],
      ['p2', 'Açúcar'],
    ]),
    creditoDisponivel: 10000,
    exigeCredito: true,
    ...parcial,
  };
}

describe('conferirPedido', () => {
  it('não acusa nada quando preço, estoque e crédito batem', () => {
    const out = conferirPedido(
      [
        { produtoId: 'p1', quantidade: 4, precoUnit: 86.4 },
        { produtoId: 'p2', quantidade: 20, precoUnit: 31 },
      ],
      dados(),
    );
    expect(out).toEqual({ divergencias: [], totalAtual: 965.6 });
  });

  it('acusa preço diferente com o valor enviado e o atual', () => {
    const out = conferirPedido(
      [{ produtoId: 'p1', quantidade: 4, precoUnit: 84 }],
      dados(),
    );
    expect(out.divergencias).toEqual([
      {
        tipo: 'preco',
        produtoId: 'p1',
        nome: 'Margarina',
        enviado: 84,
        atual: 86.4,
      },
    ]);
    expect(out.totalAtual).toBe(345.6);
  });

  it('tolera diferença menor que meio centavo', () => {
    const out = conferirPedido(
      [{ produtoId: 'p1', quantidade: 1, precoUnit: 86.404 }],
      dados(),
    );
    expect(out.divergencias).toEqual([]);
  });

  it('acusa produto sem preço na tabela escolhida', () => {
    const out = conferirPedido(
      [{ produtoId: 'p1', quantidade: 1, precoUnit: 86.4 }],
      dados({ precos: new Map() }),
    );
    expect(out.divergencias).toEqual([
      { tipo: 'sem_preco', produtoId: 'p1', nome: 'Margarina', enviado: 86.4 },
    ]);
    expect(out.totalAtual).toBe(0);
  });

  it('acusa estoque insuficiente com a quantidade pedida e a disponível', () => {
    const out = conferirPedido(
      [{ produtoId: 'p2', quantidade: 20, precoUnit: 31 }],
      dados({ estoques: new Map([['p2', 5]]) }),
    );
    expect(out.divergencias).toEqual([
      {
        tipo: 'estoque',
        produtoId: 'p2',
        nome: 'Açúcar',
        enviado: 20,
        atual: 5,
      },
    ]);
  });

  it('acusa crédito insuficiente pelo total atual', () => {
    const out = conferirPedido(
      [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }],
      dados({ creditoDisponivel: 300 }),
    );
    expect(out.divergencias).toEqual([
      { tipo: 'credito', enviado: 345.6, atual: 300 },
    ]);
  });

  it('não confere crédito em pagamento à vista nem quando o ERP não informou limite', () => {
    const item = [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }];
    expect(
      conferirPedido(item, dados({ creditoDisponivel: 0, exigeCredito: false }))
        .divergencias,
    ).toEqual([]);
    expect(
      conferirPedido(item, dados({ creditoDisponivel: null })).divergencias,
    ).toEqual([]);
  });
});

describe('arredondar', () => {
  it('arredonda meio centavo para cima mesmo quando o binário fica abaixo', () => {
    expect(arredondar(1.005)).toBe(1.01);
    expect(arredondar(10.075)).toBe(10.08);
    expect(arredondar(1234.565)).toBe(1234.57);
    expect(arredondar(345.6)).toBe(345.6);
  });
});

describe('conferirPedido com quantidade fracionada', () => {
  it('arredonda cada linha antes de somar o total', () => {
    const out = conferirPedido(
      [
        { produtoId: 'a', quantidade: 0.333, precoUnit: 1.55 },
        { produtoId: 'b', quantidade: 0.333, precoUnit: 1.55 },
        { produtoId: 'c', quantidade: 0.333, precoUnit: 1.55 },
      ],
      {
        precos: new Map([['a', 1.55], ['b', 1.55], ['c', 1.55]]),
        estoques: new Map([['a', 10], ['b', 10], ['c', 10]]),
        nomes: new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]),
        creditoDisponivel: null,
        exigeCredito: false,
      },
    );
    expect(out).toEqual({ divergencias: [], totalAtual: 1.56 });
  });
});
