import { conferirPedido, DadosAtuais } from './conferir-pedido';

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
