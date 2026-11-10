import { Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import {
  dinheiro,
  escolher,
  iso,
  n,
  nOuNulo,
  padraoBusca,
  paginaDe,
  POR_PAGINA,
  SQL_STATUS_VENDA,
  uuidOpcional,
} from './admin-vendas-util';

const SITUACOES = [
  'todos',
  'retidos',
  'liberados',
  'faturados',
  'cancelados',
] as const;
const STATUS_POR_SITUACAO: Record<string, string[]> = {
  retidos: ['AGUARDANDO_VENDEDOR'],
  liberados: ['RECEBIDO', 'ENVIADO_ERP', 'ABERTO', 'EM_FATURAMENTO'],
  faturados: ['FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE'],
  cancelados: ['CANCELADO'],
};
const STATUS_ORCAMENTO = ['aberto', 'convertido', 'cancelado'] as const;

/** Filtros montados só com o que foi informado; valores sempre por parâmetro. */
class Filtro {
  readonly condicoes: string[];
  readonly params: unknown[] = [];
  constructor(...fixas: string[]) {
    this.condicoes = [...fixas];
  }
  /** Registra o valor e devolve o marcador $n (com cast opcional). */
  p(valor: unknown, cast = ''): string {
    this.params.push(valor);
    return `$${this.params.length}${cast}`;
  }
  add(sql: string) {
    this.condicoes.push(sql);
  }
  get onde(): string {
    return this.condicoes.length ? `where ${this.condicoes.join(' and ')}` : '';
  }
}

const divergenciasDe = (
  status: string,
  retencao: { divergencias?: unknown[] } | null,
): unknown[] =>
  status === 'AGUARDANDO_VENDEDOR' ? (retencao?.divergencias ?? []) : [];

const CIDADE_PADRAO = `(select e.cidade from cliente_enderecos e where e.cliente_id = c.id order by e.padrao desc, e.id limit 1)`;
const ULTIMO_PEDIDO = `(select max(p.criado_em) from pedidos p where p.cliente_id = c.id and p.origem = 'vendedor' and ${SQL_STATUS_VENDA})`;

export interface ListaParametros {
  pagina?: unknown;
  busca?: unknown;
  vendedorId?: unknown;
  situacao?: unknown;
  status?: unknown;
  tabelaId?: unknown;
  estoque?: unknown;
  imagem?: unknown;
}

@Injectable()
export class AdminVendasConsultasService {
  async pedidos(q: ListaParametros) {
    const { pool } = tenantCtx();
    const situacao = escolher(q.situacao, SITUACOES, 'todos');
    const vendedorId = uuidOpcional(q.vendedorId, 'vendedorId');
    const busca = padraoBusca(q.busca);
    const pagina = paginaDe(q.pagina);

    const f = new Filtro(`p.origem = 'vendedor'`);
    if (situacao !== 'todos')
      f.add(
        `p.status = any(${f.p(STATUS_POR_SITUACAO[situacao], '::text[]')})`,
      );
    if (vendedorId) f.add(`p.vendedor_id = ${f.p(vendedorId, '::uuid')}`);
    if (busca) {
      const b = f.p(busca);
      f.add(
        `(c.nome_fantasia ilike ${b} or c.razao_social ilike ${b} or c.documento ilike ${b} or c.erp_cliente_id ilike ${b} or p.numero::text ilike ${b})`,
      );
    }

    const total = await pool.query(
      `/* pedidos-total */
       select count(*)::int as total from pedidos p join clientes c on c.id = p.cliente_id ${f.onde}`,
      f.params,
    );
    const { rows } = await pool.query(
      `/* pedidos-dados */
       select p.id, p.numero, p.criado_em, c.nome_fantasia as cliente, c.erp_cliente_id as cliente_codigo, vd.nome as vendedor,
              t.nome as tabela, fp.descricao as forma, p.total, p.status, p.retencao_json
         from pedidos p
         join clientes c on c.id = p.cliente_id
         left join vendedores vd on vd.id = p.vendedor_id
         left join tabelas_preco t on t.id = p.tabela_preco_id
         left join formas_pagamento_erp fp on fp.id = p.forma_pagamento_erp_id
         ${f.onde}
        order by p.criado_em desc, p.numero desc
        limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`,
      f.params,
    );
    return {
      dados: rows.map((r) => ({
        id: r.id,
        numero: n(r.numero),
        criadoEm: iso(r.criado_em),
        cliente: r.cliente,
        clienteCodigo: r.cliente_codigo ?? null,
        vendedor: r.vendedor ?? null,
        tabela: r.tabela ?? null,
        forma: r.forma ?? null,
        total: dinheiro(n(r.total)),
        status: r.status,
        divergencias: divergenciasDe(r.status, r.retencao_json),
      })),
      pagina,
      total: n(total.rows[0]?.total),
    };
  }

  async pedido(id: string) {
    const { pool } = tenantCtx();
    const cab = await pool.query(
      `/* pedido-cab */
       select p.id, p.numero, p.criado_em, c.nome_fantasia as cliente, c.erp_cliente_id as cliente_codigo, c.documento as cliente_documento,
              c.telefone as cliente_telefone, vd.nome as vendedor, t.nome as tabela,
              fp.descricao as forma, p.tipo_entrega, p.observacoes, p.subtotal, p.desconto, p.total, p.status, p.retencao_json,
              p.endereco_snapshot_json as endereco
         from pedidos p
         join clientes c on c.id = p.cliente_id
         left join vendedores vd on vd.id = p.vendedor_id
         left join tabelas_preco t on t.id = p.tabela_preco_id
         left join formas_pagamento_erp fp on fp.id = p.forma_pagamento_erp_id
        where p.id = $1 and p.origem = 'vendedor'`,
      [id],
    );
    const p = cab.rows[0];
    if (!p)
      throw new NotFoundException({
        statusCode: 404,
        message: 'Pedido não encontrado',
        codigo: 'PEDIDO_NAO_ENCONTRADO',
      });
    const [itens, eventos] = await Promise.all([
      pool.query(
        `/* pedido-itens */
         select i.descricao_snapshot as produto, coalesce(pr.erp_produto_id, pr.sku) as codigo, i.quantidade, i.preco_unit, i.total
           from pedido_itens i join produtos pr on pr.id = i.produto_id
          where i.pedido_id = $1
          order by i.descricao_snapshot, pr.id`,
        [id],
      ),
      pool.query(
        `/* pedido-eventos */
         select e.status, e.detalhe, e.origem, e.criado_em from pedido_eventos e where e.pedido_id = $1 order by e.criado_em, e.id`,
        [id],
      ),
    ]);
    return {
      id: p.id,
      numero: n(p.numero),
      criadoEm: iso(p.criado_em),
      status: p.status,
      cliente: p.cliente,
      clienteCodigo: p.cliente_codigo ?? null,
      clienteDocumento: p.cliente_documento ?? null,
      clienteTelefone: p.cliente_telefone ?? null,
      vendedor: p.vendedor ?? null,
      tabela: p.tabela ?? null,
      forma: p.forma ?? null,
      tipoEntrega: p.tipo_entrega,
      observacoes: p.observacoes ?? null,
      endereco: p.endereco ?? null,
      subtotal: dinheiro(n(p.subtotal)),
      desconto: dinheiro(n(p.desconto)),
      total: dinheiro(n(p.total)),
      itens: itens.rows.map((i) => ({
        produto: i.produto,
        codigo: i.codigo,
        quantidade: n(i.quantidade),
        precoUnit: dinheiro(n(i.preco_unit)),
        total: dinheiro(n(i.total)),
      })),
      divergencias: divergenciasDe(p.status, p.retencao_json),
      eventos: eventos.rows.map((e) => ({
        status: e.status,
        detalhe: e.detalhe ?? null,
        origem: e.origem,
        criadoEm: iso(e.criado_em),
      })),
    };
  }

  async orcamentos(q: ListaParametros) {
    const { pool } = tenantCtx();
    const status =
      typeof q.status === 'string' &&
      (STATUS_ORCAMENTO as readonly string[]).includes(q.status)
        ? q.status
        : null;
    const vendedorId = uuidOpcional(q.vendedorId, 'vendedorId');
    const pagina = paginaDe(q.pagina);

    const f = new Filtro();
    if (status) f.add(`o.status = ${f.p(status)}`);
    if (vendedorId) f.add(`o.vendedor_id = ${f.p(vendedorId, '::uuid')}`);

    const total = await pool.query(
      `/* orcamentos-total */ select count(*)::int as total from orcamentos o ${f.onde}`,
      f.params,
    );
    const { rows } = await pool.query(
      `/* orcamentos-dados */
       select o.id, c.nome_fantasia as cliente, vd.nome as vendedor, t.nome as tabela, fp.descricao as forma, o.total,
              (select count(*)::int from orcamento_itens oi where oi.orcamento_id = o.id) as itens,
              o.status, ped.numero as pedido_numero, o.atualizado_em
         from orcamentos o
         join clientes c on c.id = o.cliente_id
         join vendedores vd on vd.id = o.vendedor_id
         join tabelas_preco t on t.id = o.tabela_preco_id
         left join formas_pagamento_erp fp on fp.id = o.forma_pagamento_erp_id
         left join pedidos ped on ped.id = o.pedido_id
         ${f.onde}
        order by o.atualizado_em desc, o.id
        limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`,
      f.params,
    );
    return {
      dados: rows.map((r) => ({
        id: r.id,
        cliente: r.cliente,
        vendedor: r.vendedor,
        tabela: r.tabela,
        forma: r.forma ?? null,
        total: dinheiro(n(r.total)),
        itens: n(r.itens),
        status: r.status,
        pedidoNumero: nOuNulo(r.pedido_numero),
        atualizadoEm: iso(r.atualizado_em),
      })),
      pagina,
      total: n(total.rows[0]?.total),
    };
  }

  /** Só clientes que estão em alguma carteira (ou na do vendedor filtrado). */
  async clientes(q: ListaParametros) {
    const { pool } = tenantCtx();
    const vendedorId = uuidOpcional(q.vendedorId, 'vendedorId');
    const busca = padraoBusca(q.busca);
    const pagina = paginaDe(q.pagina);

    const f = new Filtro(`c.status <> 'excluido'`);
    f.add(
      `exists (select 1 from cliente_vendedor cv where cv.cliente_id = c.id${vendedorId ? ` and cv.vendedor_id = ${f.p(vendedorId, '::uuid')}` : ''})`,
    );
    if (busca) {
      const b = f.p(busca);
      f.add(
        `(c.nome_fantasia ilike ${b} or c.razao_social ilike ${b} or c.documento ilike ${b} or c.erp_cliente_id ilike ${b})`,
      );
    }

    const total = await pool.query(
      `/* clientes-total */ select count(*)::int as total from clientes c ${f.onde}`,
      f.params,
    );
    const { rows } = await pool.query(
      `/* clientes-dados */
       select c.id, c.erp_cliente_id as codigo, c.razao_social, c.nome_fantasia, c.documento,
              ${CIDADE_PADRAO} as cidade,
              array(select vx.nome from cliente_vendedor cx join vendedores vx on vx.id = cx.vendedor_id where cx.cliente_id = c.id order by vx.nome) as vendedores,
              c.limite_credito,
              (select coalesce(sum(t.valor), 0) from titulos_cliente t where t.cliente_id = c.id and t.status = 'ABERTO') as em_aberto,
              ${ULTIMO_PEDIDO} as ultimo_pedido_em,
              c.status
         from clientes c
         ${f.onde}
        order by c.nome_fantasia, c.id
        limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`,
      f.params,
    );
    return {
      dados: rows.map((r) => ({
        id: r.id,
        codigo: r.codigo ?? null,
        razaoSocial: r.razao_social ?? null,
        nomeFantasia: r.nome_fantasia,
        documento: r.documento,
        cidade: r.cidade ?? null,
        vendedores: r.vendedores ?? [],
        limiteCredito: nOuNulo(r.limite_credito),
        emAberto: dinheiro(n(r.em_aberto)),
        ultimoPedidoEm: iso(r.ultimo_pedido_em),
        status: r.status,
      })),
      pagina,
      total: n(total.rows[0]?.total),
    };
  }

  async carteira(vendedorId: string) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `/* carteira */
       select c.id, c.erp_cliente_id as codigo, coalesce(c.razao_social, c.nome_fantasia) as razao_social,
              ${CIDADE_PADRAO} as cidade, ${ULTIMO_PEDIDO} as ultimo_pedido_em
         from clientes c
         join cliente_vendedor cv on cv.cliente_id = c.id
        where cv.vendedor_id = $1 and c.status <> 'excluido'
        order by coalesce(c.razao_social, c.nome_fantasia), c.id`,
      [vendedorId],
    );
    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo ?? null,
      razaoSocial: r.razao_social,
      cidade: r.cidade ?? null,
      ultimoPedidoEm: iso(r.ultimo_pedido_em),
    }));
  }

  async produtos(q: ListaParametros) {
    const { pool } = tenantCtx();
    const tabelaPedida = uuidOpcional(q.tabelaId, 'tabelaId');
    const busca = padraoBusca(q.busca);
    const pagina = paginaDe(q.pagina);
    const estoque = escolher(q.estoque, ['com', 'sem'] as const, 'todos' as 'com' | 'sem' | 'todos');
    const imagem = escolher(q.imagem, ['com', 'sem'] as const, 'todos' as 'com' | 'sem' | 'todos');

    const t = await pool.query(
      `/* produtos-tabelas */ select id, nome from tabelas_preco where erp_tabela_id is not null order by nome, id`,
    );
    const tabelas = t.rows.map((r) => ({
      id: r.id as string,
      nome: r.nome as string,
    }));
    // Sem tabela do ERP a lista continua valendo (a foto é do produto): só fica sem preço.
    const tabelaId = tabelas.length
      ? (tabelas.find((x) => x.id === tabelaPedida) ?? tabelas[0]).id
      : null;

    const COM_ESTOQUE = `coalesce(es.quantidade, 0) > 0`;
    const SEM_ESTOQUE = `coalesce(es.quantidade, 0) <= 0`;
    const TEM_IMAGEM = `exists (select 1 from produto_imagens i where i.produto_id = pr.id)`;
    // Filtro de produtos: busca sempre; estoque e imagem só quando pedidos.
    const filtro = (o: { tabela?: boolean; estoque?: boolean; imagem?: boolean }) => {
      const f = new Filtro();
      if (o.tabela) f.p(tabelaId, '::uuid');
      if (busca) {
        const b = f.p(busca);
        f.add(
          `(pr.nome ilike ${b} or pr.sku ilike ${b} or pr.ean ilike ${b} or pr.erp_produto_id ilike ${b})`,
        );
      }
      if (o.estoque && estoque === 'com') f.add(COM_ESTOQUE);
      if (o.estoque && estoque === 'sem') f.add(SEM_ESTOQUE);
      if (o.imagem && imagem === 'com') f.add(TEM_IMAGEM);
      if (o.imagem && imagem === 'sem') f.add(`not ${TEM_IMAGEM}`);
      return f;
    };

    // Contagens dos chips (como no Delivery): estoque respeita a busca mas não o filtro de estoque...
    const fe = filtro({});
    const cEstoque = await pool.query(
      `/* produtos-contagem-estoque */
       select count(*)::int as todos,
              count(*) filter (where ${COM_ESTOQUE})::int as com_estoque,
              count(*) filter (where ${SEM_ESTOQUE})::int as sem_estoque
         from produtos pr left join estoques es on es.produto_id = pr.id ${fe.onde}`,
      fe.params,
    );
    // ...e imagem conta DENTRO do estoque escolhido ("dos 188 com estoque, quantos têm foto").
    const fi = filtro({ estoque: true });
    const cImagem = await pool.query(
      `/* produtos-contagem-imagem */
       select count(*) filter (where ${TEM_IMAGEM})::int as com_imagem,
              count(*) filter (where not ${TEM_IMAGEM})::int as sem_imagem
         from produtos pr left join estoques es on es.produto_id = pr.id ${fi.onde}`,
      fi.params,
    );

    const ft = filtro({ estoque: true, imagem: true });
    const total = await pool.query(
      `/* produtos-total */
       select count(*)::int as total from produtos pr left join estoques es on es.produto_id = pr.id ${ft.onde}`,
      ft.params,
    );
    const fd = filtro({ tabela: true, estoque: true, imagem: true });
    const { rows } = await pool.query(
      `/* produtos-dados */
       select pr.id, coalesce(pr.erp_produto_id, pr.sku) as codigo, pr.nome, cat.nome as categoria,
              pr.unidade_venda as unidade, coalesce(es.quantidade, 0) as estoque, pc.preco, pr.ativo,
              (select coalesce(url_miniatura, url) from produto_imagens where produto_id = pr.id order by ordem asc limit 1) as imagem_url
         from produtos pr
         left join precos pc on pc.produto_id = pr.id
                            and pc.tabela_preco_id = $1::uuid
         left join categorias cat on cat.id = pr.categoria_id
         left join estoques es on es.produto_id = pr.id
         ${fd.onde}
        order by pr.nome, pr.id
        limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`,
      fd.params,
    );
    const ce = cEstoque.rows[0];
    const ci = cImagem.rows[0];
    return {
      tabelas,
      tabelaId,
      dados: rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nome: r.nome,
        categoria: r.categoria ?? null,
        unidade: r.unidade ?? null,
        estoque: n(r.estoque),
        preco: r.preco === null || r.preco === undefined ? null : dinheiro(n(r.preco)),
        ativo: r.ativo,
        imagemUrl: r.imagem_url ?? null,
      })),
      pagina,
      total: n(total.rows[0]?.total),
      contagens: {
        todos: n(ce?.todos),
        comEstoque: n(ce?.com_estoque),
        semEstoque: n(ce?.sem_estoque),
        comImagem: n(ci?.com_imagem),
        semImagem: n(ci?.sem_imagem),
      },
    };
  }
}
