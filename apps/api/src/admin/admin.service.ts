import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';

@Injectable()
export class AdminService {
  async dashboard() {
    const { pool } = tenantCtx();
    const [hoje, porStatus, mes, topProdutos, pendentes, falhas] = await Promise.all([
      pool.query(
        `select count(*)::int as pedidos, coalesce(sum(total),0) as faturamento
           from pedidos where criado_em::date = current_date and status <> 'CANCELADO'`,
      ),
      pool.query(`select status, count(*)::int as qtd from pedidos group by status`),
      pool.query(
        `select count(*)::int as pedidos, coalesce(sum(total),0) as faturamento,
                coalesce(avg(total),0) as ticket_medio
           from pedidos where criado_em > now() - interval '30 days' and status <> 'CANCELADO'`,
      ),
      pool.query(
        `select i.descricao_snapshot as produto, sum(i.quantidade)::numeric as qtd, sum(i.total) as valor
           from pedido_itens i join pedidos p on p.id = i.pedido_id
          where p.criado_em > now() - interval '30 days' and p.status <> 'CANCELADO'
          group by 1 order by valor desc limit 5`,
      ),
      pool.query(`select count(*)::int as qtd from clientes where status = 'pendente'`),
      pool.query(
        `select count(*)::int as qtd from pedidos where status = 'FALHA_INTEGRACAO'`,
      ),
    ]);
    return {
      hoje: hoje.rows[0],
      ultimos30d: mes.rows[0],
      porStatus: porStatus.rows,
      topProdutos: topProdutos.rows,
      clientesPendentes: pendentes.rows[0].qtd,
      falhasIntegracao: falhas.rows[0].qtd,
    };
  }

  async pedidos(f: { status?: string; busca?: string; pagina: number }) {
    const { pool } = tenantCtx();
    const cond: string[] = ['true'];
    const params: unknown[] = [];
    if (f.status) {
      params.push(f.status);
      cond.push(`p.status = $${params.length}`);
    }
    if (f.busca) {
      params.push(`%${f.busca}%`);
      cond.push(`(p.numero::text ilike $${params.length} or c.nome_fantasia ilike $${params.length} or c.documento ilike $${params.length})`);
    }
    params.push((f.pagina - 1) * 25);
    const { rows } = await pool.query(
      `select p.id, p.numero, p.status, p.forma_pagamento, p.total, p.erp_pedido_id, p.criado_em,
              c.nome_fantasia as cliente, c.documento
         from pedidos p join clientes c on c.id = p.cliente_id
        where ${cond.join(' and ')}
        order by p.criado_em desc limit 25 offset $${params.length}`,
      params,
    );
    return { dados: rows, pagina: f.pagina };
  }

  async pedido(id: string) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.*, c.nome_fantasia as cliente, c.documento, c.email, c.telefone,
        (select json_agg(json_build_object('descricao', i.descricao_snapshot, 'quantidade', i.quantidade,
            'precoUnit', i.preco_unit, 'total', i.total)) from pedido_itens i where i.pedido_id = p.id) as itens,
        (select json_agg(json_build_object('status', e.status, 'detalhe', e.detalhe, 'origem', e.origem,
            'em', e.criado_em) order by e.criado_em) from pedido_eventos e where e.pedido_id = p.id) as eventos,
        (select row_to_json(co) from pedido_cobrancas co where co.pedido_id = p.id) as cobranca,
        (select row_to_json(n) from pedido_notas n where n.pedido_id = p.id) as nota
         from pedidos p join clientes c on c.id = p.cliente_id where p.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Pedido não encontrado');
    return rows[0];
  }

  /** Reenfileira um pedido com falha de integração para novo envio ao ERP. */
  async reenviarErp(id: string, usuarioId: string) {
    const { pool } = tenantCtx();
    const ped = await pool.query(`select status from pedidos where id = $1`, [id]);
    if (!ped.rows[0]) throw new NotFoundException('Pedido não encontrado');
    if (ped.rows[0].status !== 'FALHA_INTEGRACAO') {
      throw new BadRequestException('Só é possível reenviar pedidos com falha de integração');
    }
    await pool.query(`update pedidos set status = 'RECEBIDO' where id = $1`, [id]);
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'RECEBIDO','Reenvio manual pela retaguarda','retaguarda')`,
      [id],
    );
    await pool.query(
      `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
      [id],
    );
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id) values ($1,'reenviar_erp','pedido',$2)`,
      [usuarioId, id],
    );
    return { ok: true };
  }

  async clientes(f: { status?: string; busca?: string; pagina: number }) {
    const { pool } = tenantCtx();
    const cond: string[] = ['true'];
    const params: unknown[] = [];
    if (f.status) {
      params.push(f.status);
      cond.push(`status = $${params.length}`);
    }
    if (f.busca) {
      params.push(`%${f.busca}%`);
      cond.push(`(nome_fantasia ilike $${params.length} or documento ilike $${params.length} or email ilike $${params.length})`);
    }
    params.push((f.pagina - 1) * 25);
    const { rows } = await pool.query(
      `select id, tipo, documento, nome_fantasia, email, telefone, status, criado_em,
        (select count(*)::int from pedidos p where p.cliente_id = clientes.id) as pedidos
         from clientes where ${cond.join(' and ')}
        order by criado_em desc limit 25 offset $${params.length}`,
      params,
    );
    return { dados: rows, pagina: f.pagina };
  }

  async mudarStatusCliente(id: string, status: 'aprovado' | 'bloqueado' | 'pendente', usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(`update clientes set status = $2 where id = $1 returning id`, [id, status]);
    if (!r.rowCount) throw new NotFoundException('Cliente não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'mudar_status','cliente',$2,$3)`,
      [usuarioId, id, JSON.stringify({ status })],
    );
    return { ok: true };
  }

  /**
   * Exclui um cliente. Sem pedido nenhum: apaga a linha de verdade (limpa
   * endereços, credenciais, carrinho, dispositivos e inbox antes). Com pedido:
   * não dá pra apagar (nota fiscal/histórico de venda referencia o cliente) —
   * anonimiza os dados pessoais e marca status 'excluido' (login bloqueado).
   */
  async excluirCliente(id: string, usuarioId: string) {
    const { pool } = tenantCtx();
    const cliente = await pool.query(`select id from clientes where id = $1`, [id]);
    if (!cliente.rows[0]) throw new NotFoundException('Cliente não encontrado');
    const temPedido = await pool.query(`select 1 from pedidos where cliente_id = $1 limit 1`, [id]);

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `delete from carrinho_itens where carrinho_id in (select id from carrinhos where cliente_id = $1)`,
        [id],
      );
      await client.query(`delete from carrinhos where cliente_id = $1`, [id]);
      await client.query(`delete from cliente_enderecos where cliente_id = $1`, [id]);
      await client.query(`delete from cliente_credenciais where cliente_id = $1`, [id]);
      await client.query(`delete from dispositivos where cliente_id = $1`, [id]);
      await client.query(`delete from notificacao_entregas where cliente_id = $1`, [id]);
      await client.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'cliente'`, [id]);

      if (temPedido.rowCount) {
        await client.query(
          `update clientes set status = 'excluido', nome_fantasia = 'Cliente excluído',
                  razao_social = null, telefone = null, email = $2
            where id = $1`,
          [id, `excluido+${id}@removido.local`],
        );
      } else {
        await client.query(`delete from clientes where id = $1`, [id]);
      }
      await client.query(
        `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
         values ($1,'excluir','cliente',$2,$3)`,
        [usuarioId, id, JSON.stringify({ removidoDeVerdade: !temPedido.rowCount })],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true, removidoDeVerdade: !temPedido.rowCount };
  }

  async produtos(f: { busca?: string; pagina: number }) {
    const { pool } = tenantCtx();
    const cond: string[] = ['true'];
    const params: unknown[] = [];
    if (f.busca) {
      params.push(`%${f.busca}%`);
      cond.push(`(p.nome ilike $${params.length} or p.sku ilike $${params.length})`);
    }
    params.push((f.pagina - 1) * 25);
    const { rows } = await pool.query(
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco,
              c.nome as categoria, m.nome as marca,
              coalesce(e.quantidade,0) as estoque,
              (select preco from precos pr join tabelas_preco t on t.id = pr.tabela_preco_id and t.padrao
                where pr.produto_id = p.id) as preco
         from produtos p
         left join categorias c on c.id = p.categoria_id
         left join marcas m on m.id = p.marca_id
         left join estoques e on e.produto_id = p.id
        where ${cond.join(' and ')}
        order by p.nome limit 25 offset $${params.length}`,
      params,
    );
    return { dados: rows, pagina: f.pagina };
  }

  async alternarProduto(id: string, ativo: boolean, usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(`update produtos set ativo = $2 where id = $1 returning id`, [id, ativo]);
    if (!r.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'alternar_ativo','produto',$2,$3)`,
      [usuarioId, id, JSON.stringify({ ativo })],
    );
    return { ok: true };
  }

  async descontoQtdProduto(id: string, minima: number | null, preco: number | null, usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(
      `update produtos set desconto_qtd_minima = $2, desconto_qtd_preco = $3 where id = $1 returning id`,
      [id, minima, preco],
    );
    if (!r.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'editar_desconto_qtd','produto',$2,$3)`,
      [usuarioId, id, JSON.stringify({ descontoQtdMinima: minima, descontoQtdPreco: preco })],
    );
    return { ok: true };
  }

  async logsIntegracao(pagina: number) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, operacao, direcao, request_resumo, sucesso, duracao_ms, criado_em
         from integracao_logs order by criado_em desc limit 50 offset $1`,
      [(pagina - 1) * 50],
    );
    return { dados: rows, pagina };
  }
}
