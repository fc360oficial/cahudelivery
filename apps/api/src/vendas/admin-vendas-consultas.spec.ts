import { BadRequestException, NotFoundException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminVendasConsultasService } from './admin-vendas-consultas.service';

const V1 = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222222';
const T2 = '33333333-3333-4333-8333-333333333333';

function montar(respostas: Record<string, unknown[]> = {}) {
  const query = jest.fn(async (sql: string) => {
    for (const [tag, rows] of Object.entries(respostas))
      if (sql.includes(tag)) return { rows };
    return { rows: [] };
  });
  const rodar = <T>(fn: () => Promise<T>) =>
    runComTenant({ tenant: {}, pool: { query } } as never, fn);
  const chamada = (tag: string) =>
    query.mock.calls.find(([s]) => String(s).includes(tag))!;
  return {
    svc: new AdminVendasConsultasService(),
    rodar,
    sql: (tag: string) => String(chamada(tag)[0]),
    params: (tag: string) => chamada(tag)[1] as unknown[],
    query,
  };
}

const linhaPedido = {
  id: 'p1',
  numero: '501',
  criado_em: new Date('2026-11-10T14:00:00Z'),
  cliente: 'Mercado X',
  cliente_codigo: '123',
  vendedor: 'Ana',
  tabela: 'Atacado',
  forma: 'Boleto',
  total: '120.50',
  status: 'AGUARDANDO_VENDEDOR',
  retencao_json: { divergencias: [{ tipo: 'PRECO', produtoId: 'x' }] },
};

describe('pedidos (lista)', () => {
  it('formato do contrato, 30 por página e total do filtro', async () => {
    const { svc, rodar, sql, params } = montar({
      '/* pedidos-total */': [{ total: '61' }],
      '/* pedidos-dados */': [linhaPedido],
    });
    const out = await rodar(() => svc.pedidos({ pagina: '3' }));
    expect(out).toEqual({
      dados: [
        {
          id: 'p1',
          numero: 501,
          criadoEm: '2026-11-10T14:00:00.000Z',
          cliente: 'Mercado X',
          clienteCodigo: '123',
          vendedor: 'Ana',
          tabela: 'Atacado',
          forma: 'Boleto',
          total: 120.5,
          status: 'AGUARDANDO_VENDEDOR',
          divergencias: [{ tipo: 'PRECO', produtoId: 'x' }],
        },
      ],
      pagina: 3,
      total: 61,
    });
    expect(sql('/* pedidos-dados */')).toContain("origem = 'vendedor'");
    expect(sql('/* pedidos-total */')).toContain("origem = 'vendedor'");
    expect(sql('/* pedidos-dados */')).toContain('limit 30 offset 60');
    expect(params('/* pedidos-total */')).toEqual([]);
  });

  it('divergências só aparecem em pedido retido', async () => {
    const { svc, rodar } = montar({
      '/* pedidos-total */': [{ total: 1 }],
      '/* pedidos-dados */': [{ ...linhaPedido, status: 'RECEBIDO' }],
    });
    const out = await rodar(() => svc.pedidos({}));
    expect(out.dados[0].divergencias).toEqual([]);
  });

  it('situacao, vendedorId e busca só entram no SQL quando informados', async () => {
    const livre = montar();
    await livre.rodar(() => livre.svc.pedidos({}));
    const s = livre.sql('/* pedidos-dados */');
    expect(s).not.toContain('p.status = any');
    expect(s).not.toContain('p.vendedor_id =');
    expect(s).not.toContain('ilike');

    const filtrado = montar();
    await filtrado.rodar(() =>
      filtrado.svc.pedidos({
        situacao: 'retidos',
        vendedorId: V1,
        busca: '50%',
      }),
    );
    const f = filtrado.sql('/* pedidos-dados */');
    expect(f).toContain('p.status = any(');
    expect(f).toContain('p.vendedor_id =');
    expect(f).toContain('ilike');
    const p = filtrado.params('/* pedidos-dados */');
    expect(p).toContainEqual(['AGUARDANDO_VENDEDOR']);
    expect(p).toContain(V1);
    expect(p).toContain('%50\\%%');
  });

  it('liberados = RECEBIDO, ENVIADO_ERP, ABERTO, EM_FATURAMENTO; cancelados = CANCELADO', async () => {
    const a = montar();
    await a.rodar(() => a.svc.pedidos({ situacao: 'liberados' }));
    expect(a.params('/* pedidos-dados */')).toContainEqual([
      'RECEBIDO',
      'ENVIADO_ERP',
      'ABERTO',
      'EM_FATURAMENTO',
    ]);
    const b = montar();
    await b.rodar(() => b.svc.pedidos({ situacao: 'cancelados' }));
    expect(b.params('/* pedidos-dados */')).toContainEqual(['CANCELADO']);
  });

  it('situacao inválida = todos; página inválida = 1; vendedorId inválido = 400', async () => {
    const a = montar();
    const out = await a.rodar(() =>
      a.svc.pedidos({ situacao: 'xyz', pagina: '-4' }),
    );
    expect(out.pagina).toBe(1);
    expect(a.sql('/* pedidos-dados */')).not.toContain('p.status = any');
    expect(a.sql('/* pedidos-dados */')).toContain('limit 30 offset 0');
    const b = montar();
    await expect(
      b.rodar(() => b.svc.pedidos({ vendedorId: 'nao-uuid' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('pedido (detalhe)', () => {
  const cab = {
    ...linhaPedido,
    cliente_documento: '12345678000100',
    cliente_telefone: '8199',
    forma: 'Boleto',
    tipo_entrega: 'entrega',
    observacoes: 'urgente',
    subtotal: '120.50',
    desconto: '0',
    endereco: { logradouro: 'Rua A', cidade: 'Recife' },
  };
  it('monta cabeçalho, itens e eventos', async () => {
    const { svc, rodar, sql } = montar({
      '/* pedido-cab */': [cab],
      '/* pedido-itens */': [
        {
          produto: 'Arroz 5kg',
          codigo: 'A1',
          quantidade: '2.000',
          preco_unit: '10.25',
          total: '20.50',
        },
      ],
      '/* pedido-eventos */': [
        {
          status: 'RECEBIDO',
          detalhe: null,
          origem: 'app',
          criado_em: new Date('2026-11-10T14:00:00Z'),
        },
      ],
    });
    const out = await rodar(() => svc.pedido(T1));
    expect(out).toMatchObject({
      id: 'p1',
      numero: 501,
      cliente: 'Mercado X',
      clienteCodigo: '123',
      clienteDocumento: '12345678000100',
      vendedor: 'Ana',
      tabela: 'Atacado',
      forma: 'Boleto',
      tipoEntrega: 'entrega',
      total: 120.5,
      subtotal: 120.5,
      desconto: 0,
      status: 'AGUARDANDO_VENDEDOR',
      endereco: { logradouro: 'Rua A', cidade: 'Recife' },
      divergencias: [{ tipo: 'PRECO', produtoId: 'x' }],
      itens: [
        {
          produto: 'Arroz 5kg',
          codigo: 'A1',
          quantidade: 2,
          precoUnit: 10.25,
          total: 20.5,
        },
      ],
      eventos: [
        {
          status: 'RECEBIDO',
          detalhe: null,
          origem: 'app',
          criadoEm: '2026-11-10T14:00:00.000Z',
        },
      ],
    });
    expect(sql('/* pedido-cab */')).toContain("origem = 'vendedor'");
  });

  it('pedido que não é de vendedor (ou não existe) = 404', async () => {
    const { svc, rodar } = montar({ '/* pedido-cab */': [] });
    await expect(rodar(() => svc.pedido(T1))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('orcamentos', () => {
  it('formato do contrato, filtros opcionais e paginação', async () => {
    const { svc, rodar, sql, params } = montar({
      '/* orcamentos-total */': [{ total: '45' }],
      '/* orcamentos-dados */': [
        {
          id: 'o1',
          cliente: 'Mercado X',
          vendedor: 'Ana',
          tabela: 'Atacado',
          forma: 'PIX',
          total: '300.00',
          itens: 4,
          status: 'convertido',
          pedido_numero: '77',
          atualizado_em: new Date('2026-11-09T10:00:00Z'),
        },
      ],
    });
    const out = await rodar(() =>
      svc.orcamentos({ status: 'convertido', vendedorId: V1, pagina: '2' }),
    );
    expect(out).toEqual({
      dados: [
        {
          id: 'o1',
          cliente: 'Mercado X',
          vendedor: 'Ana',
          tabela: 'Atacado',
          forma: 'PIX',
          total: 300,
          itens: 4,
          status: 'convertido',
          pedidoNumero: 77,
          atualizadoEm: '2026-11-09T10:00:00.000Z',
        },
      ],
      pagina: 2,
      total: 45,
    });
    expect(sql('/* orcamentos-dados */')).toContain('limit 30 offset 30');
    expect(params('/* orcamentos-dados */')).toEqual(
      expect.arrayContaining(['convertido', V1]),
    );
  });

  it('sem filtro não filtra; status inválido é ignorado', async () => {
    const { svc, rodar, sql } = montar();
    await rodar(() => svc.orcamentos({ status: 'xyz' }));
    expect(sql('/* orcamentos-dados */')).not.toContain('o.status =');
    expect(sql('/* orcamentos-dados */')).not.toContain('o.vendedor_id =');
  });

  it('pedidoNumero é null sem pedido', async () => {
    const { svc, rodar } = montar({
      '/* orcamentos-total */': [{ total: 1 }],
      '/* orcamentos-dados */': [
        {
          id: 'o1',
          cliente: 'c',
          vendedor: 'v',
          tabela: 't',
          total: 1,
          itens: 1,
          status: 'aberto',
          pedido_numero: null,
          atualizado_em: '2026-11-09T10:00:00Z',
        },
      ],
    });
    expect(
      (await rodar(() => svc.orcamentos({}))).dados[0].pedidoNumero,
    ).toBeNull();
  });
});

describe('clientes', () => {
  const linha = {
    id: 'c1',
    codigo: '9',
    razao_social: 'Mercado X Ltda',
    nome_fantasia: 'Mercado X',
    documento: '123',
    cidade: 'Olinda',
    vendedores: ['Ana', 'Bia'],
    limite_credito: '5000.00',
    em_aberto: '1200.50',
    ultimo_pedido_em: new Date('2026-11-01T12:00:00Z'),
    status: 'aprovado',
  };
  it('formato do contrato e só quem está em alguma carteira', async () => {
    const { svc, rodar, sql } = montar({
      '/* clientes-total */': [{ total: '1' }],
      '/* clientes-dados */': [linha],
    });
    const out = await rodar(() => svc.clientes({}));
    expect(out).toEqual({
      dados: [
        {
          id: 'c1',
          codigo: '9',
          razaoSocial: 'Mercado X Ltda',
          nomeFantasia: 'Mercado X',
          documento: '123',
          cidade: 'Olinda',
          vendedores: ['Ana', 'Bia'],
          limiteCredito: 5000,
          emAberto: 1200.5,
          ultimoPedidoEm: '2026-11-01T12:00:00.000Z',
          status: 'aprovado',
        },
      ],
      pagina: 1,
      total: 1,
    });
    const s = sql('/* clientes-dados */');
    expect(s).toContain('from cliente_vendedor');
    expect(s).toContain("t.status = 'ABERTO'");
    expect(s).toContain('e.padrao desc');
    expect(s).not.toContain('ilike');
  });

  it('limite e último pedido nulos continuam nulos; vendedor e busca filtram', async () => {
    const { svc, rodar, sql, params } = montar({
      '/* clientes-total */': [{ total: 1 }],
      '/* clientes-dados */': [
        { ...linha, limite_credito: null, ultimo_pedido_em: null },
      ],
    });
    const out = await rodar(() =>
      svc.clientes({ vendedorId: V1, busca: 'mercado', pagina: '2' }),
    );
    expect(out.dados[0].limiteCredito).toBeNull();
    expect(out.dados[0].ultimoPedidoEm).toBeNull();
    expect(sql('/* clientes-dados */')).toContain('cv.vendedor_id =');
    expect(sql('/* clientes-dados */')).toContain('ilike');
    expect(sql('/* clientes-dados */')).toContain('limit 30 offset 30');
    expect(params('/* clientes-dados */')).toEqual(
      expect.arrayContaining([V1, '%mercado%']),
    );
  });
});

describe('carteira', () => {
  it('lista os clientes do vendedor', async () => {
    const { svc, rodar, params } = montar({
      '/* carteira */': [
        {
          id: 'c1',
          codigo: '9',
          razao_social: 'Mercado X Ltda',
          cidade: 'Olinda',
          ultimo_pedido_em: null,
        },
      ],
    });
    const out = await rodar(() => svc.carteira(V1));
    expect(out).toEqual([
      {
        id: 'c1',
        codigo: '9',
        razaoSocial: 'Mercado X Ltda',
        cidade: 'Olinda',
        ultimoPedidoEm: null,
      },
    ]);
    expect(params('/* carteira */')).toEqual([V1]);
  });
});

describe('produtos', () => {
  const tabelas = [
    { id: T1, nome: 'Atacado' },
    { id: T2, nome: 'Varejo' },
  ];
  const prod = {
    id: 'pr1',
    codigo: 'A1',
    nome: 'Arroz',
    categoria: 'Mercearia',
    estoque: '12.500',
    preco: '10.90',
    ativo: true,
  };
  it('sem tabelaId usa a primeira por nome; só tabelas do ERP', async () => {
    const { svc, rodar, sql, params } = montar({
      '/* produtos-tabelas */': tabelas,
      '/* produtos-total */': [{ total: '1' }],
      '/* produtos-dados */': [prod],
    });
    const out = await rodar(() => svc.produtos({}));
    expect(out).toEqual({
      tabelas: [
        { id: T1, nome: 'Atacado' },
        { id: T2, nome: 'Varejo' },
      ],
      tabelaId: T1,
      dados: [
        {
          id: 'pr1',
          codigo: 'A1',
          nome: 'Arroz',
          categoria: 'Mercearia',
          estoque: 12.5,
          preco: 10.9,
          ativo: true,
        },
      ],
      pagina: 1,
      total: 1,
    });
    expect(sql('/* produtos-tabelas */')).toContain(
      'erp_tabela_id is not null',
    );
    expect(sql('/* produtos-tabelas */')).toContain('order by');
    expect(params('/* produtos-dados */')).toContain(T1);
  });
  it('tabelaId válido da lista é usado; desconhecido volta para a primeira; não-UUID = 400', async () => {
    const a = montar({ '/* produtos-tabelas */': tabelas });
    expect(
      (await a.rodar(() => a.svc.produtos({ tabelaId: T2 }))).tabelaId,
    ).toBe(T2);
    const c = montar({ '/* produtos-tabelas */': tabelas });
    expect(
      (await c.rodar(() => c.svc.produtos({ tabelaId: V1 }))).tabelaId,
    ).toBe(T1);
    const b = montar({ '/* produtos-tabelas */': tabelas });
    await expect(
      b.rodar(() => b.svc.produtos({ tabelaId: 'x' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('sem tabelas do ERP devolve vazio sem consultar produtos', async () => {
    const { svc, rodar, query } = montar();
    const out = await rodar(() => svc.produtos({}));
    expect(out).toEqual({
      tabelas: [],
      tabelaId: null,
      dados: [],
      pagina: 1,
      total: 0,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('busca e paginação', async () => {
    const { svc, rodar, sql, params } = montar({
      '/* produtos-tabelas */': tabelas,
    });
    await rodar(() => svc.produtos({ busca: 'arroz', pagina: '4' }));
    expect(sql('/* produtos-dados */')).toContain('ilike');
    expect(sql('/* produtos-dados */')).toContain('limit 30 offset 90');
    expect(params('/* produtos-dados */')).toContain('%arroz%');
  });
});
