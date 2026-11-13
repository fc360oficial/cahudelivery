import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { formaInterna } from './vendas-pedidos.service';
import { origemParaContrato } from '../orders/origem-pedido';

const n = (v: unknown): number => Number(v);
const nOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));

export interface CargaVendedor {
  geradoEm: string;
  vendedor: { id: string; nome: string; erpVendedorId: string };
  clientes: Array<{
    id: string; erpClienteId: string | null; documento: string; razaoSocial: string | null; nomeFantasia: string;
    telefone: string | null; status: string; limiteCredito: number | null; emAberto: number; pedidosEmTransito: number;
    endereco: Record<string, unknown> | null;
  }>;
  titulos: Array<{ clienteId: string; numero: string; valor: number; vencimento: string; status: string }>;
  tabelas: Array<{ id: string; nome: string; erpTabelaId: string; tipoEntrega: 'entrega' | 'retirada' }>;
  formas: Array<{ id: string; descricao: string; exigeCredito: boolean }>;
  tabelaFormas: Array<{ tabelaId: string; formaId: string }>;
  categorias: Array<{ id: string; nome: string }>;
  produtos: Array<{
    id: string; sku: string; ean: string | null; nome: string; unidade: string; qtdPorEmbalagem: number;
    categoriaId: string | null; estoque: number; imagemUrl: string | null;
  }>;
  precos: Array<{ produtoId: string; tabelaId: string; preco: number }>;
  historico: Array<{
    pedidoId: string; numero: number; clienteId: string; criadoEm: string; total: number; status: string;
    origem: 'app_cliente' | 'vendedor';
    itens: Array<{ produtoId: string; quantidade: number; precoUnit: number }>;
  }>;
}

/**
 * Carga COMPLETA do que o vendedor precisa para trabalhar offline. O app troca a
 * cópia local inteira a cada sincronização — sem controle de alterações nem de exclusões.
 */
@Injectable()
export class VendasSyncService {
  async carga(vendedorId: string, appVersao?: string): Promise<CargaVendedor> {
    const { pool } = tenantCtx();
    const vend = await pool.query(`select id, nome, erp_vendedor_id from vendedores where id = $1`, [vendedorId]);

    const clientes = await pool.query(
      `/* clientes */
       select c.id, c.erp_cliente_id, c.documento, c.razao_social, c.nome_fantasia, c.telefone, c.status, c.limite_credito,
              (select coalesce(sum(t.valor),0) from titulos_cliente t where t.cliente_id = c.id and t.status = 'ABERTO') as em_aberto,
              (select coalesce(sum(p.total),0) from pedidos p
                where p.cliente_id = c.id and p.forma_pagamento = 'boleto'
                  and p.status in ('RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO')) as em_transito,
              (select row_to_json(e) from (
                 select e2.logradouro, e2.numero, e2.complemento, e2.bairro, e2.cidade, e2.uf, e2.cep
                   from cliente_enderecos e2 where e2.cliente_id = c.id order by e2.padrao desc limit 1) e) as endereco
         from clientes c join cliente_vendedor cv on cv.cliente_id = c.id
        where cv.vendedor_id = $1 and c.status <> 'excluido'
        order by c.nome_fantasia`,
      [vendedorId],
    );
    const titulos = await pool.query(
      `/* titulos */
       select t.cliente_id, t.erp_titulo_id, t.valor, to_char(t.vencimento, 'YYYY-MM-DD') as vencimento, t.status
         from titulos_cliente t join cliente_vendedor cv on cv.cliente_id = t.cliente_id
        where cv.vendedor_id = $1 and t.status = 'ABERTO'
        order by t.vencimento`,
      [vendedorId],
    );
    const tabelas = await pool.query(
      `/* tabelas */
       select t.id, t.nome, t.erp_tabela_id, t.tipo_entrega from tabelas_preco t
        where t.erp_tabela_id is not null
          and exists (select 1 from tabela_preco_formas x where x.tabela_preco_id = t.id)
        order by t.nome`,
    );
    const formas = await pool.query(`/* formas */ select id, descricao from formas_pagamento_erp order by descricao`);
    const tabelaFormas = await pool.query(
      `/* tabela_formas */
       select x.tabela_preco_id, x.forma_pagamento_id
         from tabela_preco_formas x join tabelas_preco t on t.id = x.tabela_preco_id
        where t.erp_tabela_id is not null`,
    );
    const categorias = await pool.query(`/* categorias */ select id, nome from categorias where ativo order by ordem, nome`);
    const produtos = await pool.query(
      `/* produtos */
       select p.id, p.sku, p.ean, p.nome, p.unidade_venda, p.qtd_por_embalagem, p.categoria_id,
              coalesce(e.quantidade,0) as estoque,
              (select coalesce(pi.url_miniatura, pi.url) from produto_imagens pi where pi.produto_id = p.id order by pi.ordem limit 1) as imagem_url
         from produtos p left join estoques e on e.produto_id = p.id
        where p.ativo
        order by p.nome`,
    );
    const precos = await pool.query(
      `/* precos */
       select pr.produto_id, pr.tabela_preco_id, pr.preco
         from precos pr join produtos p on p.id = pr.produto_id
         join tabelas_preco t on t.id = pr.tabela_preco_id
        where p.ativo and t.erp_tabela_id is not null`,
    );
    const historico = await pool.query(
      `/* historico */
       select p.id, p.numero, p.cliente_id, p.criado_em, p.total, p.status, p.origem,
              (select json_agg(json_build_object('produtoId', i.produto_id, 'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i where i.pedido_id = p.id) as itens
         from pedidos p join cliente_vendedor cv on cv.cliente_id = p.cliente_id
        where cv.vendedor_id = $1 and p.criado_em > now() - interval '90 days'
          and p.status not in ('CANCELADO','AGUARDANDO_PAGAMENTO','AGUARDANDO_VENDEDOR')
        order by p.criado_em desc`,
      [vendedorId],
    );

    await pool.query(
      `update vendedores set ultima_sync_em = now(), app_versao = coalesce($2, app_versao) where id = $1`,
      [vendedorId, appVersao ?? null],
    );

    const v = vend.rows[0];
    return {
      geradoEm: new Date().toISOString(),
      vendedor: { id: v.id, nome: v.nome, erpVendedorId: v.erp_vendedor_id },
      clientes: clientes.rows.map((c) => ({
        id: c.id, erpClienteId: c.erp_cliente_id, documento: c.documento, razaoSocial: c.razao_social,
        nomeFantasia: c.nome_fantasia, telefone: c.telefone, status: c.status,
        limiteCredito: nOuNulo(c.limite_credito), emAberto: n(c.em_aberto), pedidosEmTransito: n(c.em_transito), endereco: c.endereco ?? null,
      })),
      titulos: titulos.rows.map((t) => ({
        clienteId: t.cliente_id, numero: t.erp_titulo_id, valor: n(t.valor), vencimento: t.vencimento, status: t.status,
      })),
      tabelas: tabelas.rows.map((t) => ({ id: t.id, nome: t.nome, erpTabelaId: t.erp_tabela_id, tipoEntrega: t.tipo_entrega })),
      formas: formas.rows.map((f) => ({ id: f.id, descricao: f.descricao, exigeCredito: formaInterna(f.descricao) === 'boleto' })),
      tabelaFormas: tabelaFormas.rows.map((x) => ({ tabelaId: x.tabela_preco_id, formaId: x.forma_pagamento_id })),
      categorias: categorias.rows.map((c) => ({ id: c.id, nome: c.nome })),
      produtos: produtos.rows.map((p) => ({
        id: p.id, sku: p.sku, ean: p.ean, nome: p.nome, unidade: p.unidade_venda, qtdPorEmbalagem: n(p.qtd_por_embalagem),
        categoriaId: p.categoria_id, estoque: n(p.estoque), imagemUrl: p.imagem_url,
      })),
      precos: precos.rows.map((p) => ({ produtoId: p.produto_id, tabelaId: p.tabela_preco_id, preco: n(p.preco) })),
      // Pedido do site chega ao app do vendedor como app_cliente (o app só conhece app_cliente e vendedor).
      historico: historico.rows.map((h) => ({
        pedidoId: h.id, numero: n(h.numero), clienteId: h.cliente_id, criadoEm: h.criado_em, total: n(h.total), status: h.status, origem: origemParaContrato(h.origem),
        itens: (h.itens ?? []).map((i: { produtoId: string; quantidade: unknown; precoUnit: unknown }) => ({
          produtoId: i.produtoId, quantidade: n(i.quantidade), precoUnit: n(i.precoUnit),
        })),
      })),
    };
  }
}
