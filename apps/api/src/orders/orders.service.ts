import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';

export type DonoCarrinho = { clienteId?: string; deviceId?: string };

@Injectable()
export class OrdersService {
  constructor(private readonly catalog: CatalogService) {}

  private async carrinhoId(dono: DonoCarrinho): Promise<string> {
    const { pool } = tenantCtx();
    // coluna vem de whitelist fixa — sem risco de injeção
    const [col, val] = dono.clienteId ? ['cliente_id', dono.clienteId] : ['device_id', dono.deviceId];
    const { rows } = await pool.query(
      `insert into carrinhos (${col}) values ($1)
       on conflict (${col}) where ${col} is not null do update set atualizado_em = now()
       returning id`,
      [val],
    );
    return rows[0].id;
  }

  async carrinho(dono: DonoCarrinho) {
    const { pool } = tenantCtx();
    const id = await this.carrinhoId(dono);
    const tabela = await this.catalog.tabelaPrecoDe(dono.clienteId);
    const { rows } = await pool.query(
      `select ci.produto_id, ci.quantidade, p.nome, p.unidade_venda, p.qtd_minima,
              coalesce(e.quantidade,0) as estoque,
              least(
                coalesce(promo.preco_promocional, pr.preco),
                case when p.desconto_qtd_minima is not null and pr.preco is not null and ci.quantidade >= p.desconto_qtd_minima
                     then p.desconto_qtd_preco else pr.preco end
              ) as preco_atual
         from carrinho_itens ci
         join produtos p on p.id = ci.produto_id
         left join estoques e on e.produto_id = p.id
         left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $2
         left join lateral (
           select pp.preco_promocional from promocao_produtos pp
             join promocoes pm on pm.id = pp.promocao_id
            where pp.produto_id = p.id and pm.ativo and now() between pm.inicio_em and pm.fim_em
            order by pp.preco_promocional asc limit 1) promo on true
        where ci.carrinho_id = $1`,
      [id, tabela],
    );
    const subtotal = rows.reduce((t, r) => t + Number(r.preco_atual ?? 0) * Number(r.quantidade), 0);
    return { itens: rows, subtotal: Number(subtotal.toFixed(2)) };
  }

  async upsertItem(dono: DonoCarrinho, produtoId: string, quantidade: number) {
    const { pool } = tenantCtx();
    const id = await this.carrinhoId(dono);
    if (quantidade <= 0) {
      await pool.query(`delete from carrinho_itens where carrinho_id = $1 and produto_id = $2`, [id, produtoId]);
    } else {
      const tabela = await this.catalog.tabelaPrecoDe(dono.clienteId);
      const preco = await pool.query(
        `select preco from precos where produto_id = $1 and tabela_preco_id = $2`,
        [produtoId, tabela],
      );
      await pool.query(
        `insert into carrinho_itens (carrinho_id, produto_id, quantidade, preco_unit_snapshot)
         values ($1,$2,$3, coalesce($4::numeric,0))
         on conflict (carrinho_id, produto_id) do update set quantidade = $3`,
        [id, produtoId, quantidade, preco.rows[0]?.preco ?? 0],
      );
    }
    return this.carrinho(dono);
  }

  async removerItem(dono: DonoCarrinho, produtoId: string) {
    return this.upsertItem(dono, produtoId, 0);
  }

  async criarPedido(
    clienteId: string,
    dto: {
      enderecoId?: string;
      formaPagamento: 'boleto' | 'pix';
      tipoEntrega?: 'entrega' | 'retirada';
      observacoes?: string;
      condicaoPagamento?: string;
      usarSaldo?: boolean;
    },
  ) {
    const { pool } = tenantCtx();
    const cliente = await pool.query(`select status from clientes where id = $1`, [clienteId]);
    if (cliente.rows[0]?.status === 'pendente') {
      throw new BadRequestException(
        'Seu cadastro ainda está em análise. Entre em contato com a distribuidora para agilizar a aprovação antes de fechar pedidos.',
      );
    }
    const tipoEntrega = dto.tipoEntrega ?? 'entrega';
    const { itens, subtotal } = await this.carrinho({ clienteId });
    if (!itens.length) throw new BadRequestException('Carrinho vazio');
    for (const i of itens) {
      if (Number(i.estoque) < Number(i.quantidade))
        throw new BadRequestException(`Estoque insuficiente: ${i.nome}`);
    }
    const cfg = await pool.query(`select valor_json from configuracoes where chave = 'pedido_minimo'`);
    const minimo = Number(cfg.rows[0]?.valor_json?.valor ?? 0);
    if (subtotal < minimo) throw new BadRequestException(`Pedido mínimo: R$ ${minimo.toFixed(2)}`);

    let enderecoJson: string | null = null;
    if (tipoEntrega === 'entrega') {
      const end = await pool.query(`select * from cliente_enderecos where id = $1 and cliente_id = $2`, [
        dto.enderecoId,
        clienteId,
      ]);
      if (!end.rows[0]) throw new BadRequestException('Endereço inválido');
      enderecoJson = JSON.stringify(end.rows[0]);
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [clienteId]);
      let valorSaldoUsado = 0;
      if (dto.usarSaldo) {
        const saldoRow = await client.query(
          `select coalesce(sum(valor),0) as saldo from carteira_movimentos where cliente_id = $1`,
          [clienteId],
        );
        const saldo = Number(saldoRow.rows[0].saldo);
        valorSaldoUsado = Math.min(saldo, subtotal);
      }
      const ped = await client.query(
        `insert into pedidos (cliente_id, endereco_snapshot_json, forma_pagamento, tipo_entrega, subtotal, total, observacoes, condicao_pagamento, valor_saldo_usado)
         values ($1,$2,$3,$4,$5,$5,$6,$7,$8) returning id, numero, status, criado_em`,
        [
          clienteId,
          enderecoJson,
          dto.formaPagamento,
          tipoEntrega,
          subtotal,
          dto.observacoes ?? null,
          dto.formaPagamento === 'boleto' ? (dto.condicaoPagamento ?? 'À vista') : null,
          valorSaldoUsado,
        ],
      );
      const pedidoId = ped.rows[0].id;
      for (const i of itens) {
        await client.query(
          `insert into pedido_itens (pedido_id, produto_id, descricao_snapshot, quantidade, preco_unit, total)
           values ($1,$2,$3,$4,$5,$6)`,
          [pedidoId, i.produto_id, i.nome, i.quantidade, i.preco_atual, Number(i.preco_atual) * Number(i.quantidade)],
        );
      }
      if (valorSaldoUsado > 0) {
        await client.query(
          `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id)
           values ($1, $2, $3, $4)`,
          [clienteId, -valorSaldoUsado, `Uso no pedido #${ped.rows[0].numero}`, pedidoId],
        );
      }
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'RECEBIDO','Pedido recebido','app')`,
        [pedidoId],
      );
      // Outbox transacional: o worker envia ao ERP; pedido nunca se perde
      await client.query(
        `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
        [pedidoId],
      );
      await client.query(`delete from carrinho_itens where carrinho_id = (select id from carrinhos where cliente_id = $1)`, [clienteId]);
      await client.query('commit');
      return ped.rows[0];
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async listar(clienteId: string, pagina: number) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, numero, status, forma_pagamento, total, criado_em
         from pedidos where cliente_id = $1 order by criado_em desc limit 20 offset $2`,
      [clienteId, (pagina - 1) * 20],
    );
    return { dados: rows, pagina };
  }

  async notas(clienteId: string, pagina: number) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.id as pedido_id, p.numero, p.total,
              n.numero_nf, n.chave_acesso, n.pdf_url, n.emitida_em
         from pedidos p
         join pedido_notas n on n.pedido_id = p.id
        where p.cliente_id = $1
        order by n.emitida_em desc
        limit 20 offset $2`,
      [clienteId, (pagina - 1) * 20],
    );
    return { dados: rows, pagina };
  }

  async detalhe(clienteId: string, pedidoId: string) {
    const { pool } = tenantCtx();
    const ped = await pool.query(
      `select p.*,
        (select json_agg(json_build_object('produtoId', i.produto_id, 'descricao', i.descricao_snapshot,
            'quantidade', i.quantidade, 'precoUnit', i.preco_unit, 'total', i.total))
           from pedido_itens i where i.pedido_id = p.id) as itens,
        (select json_agg(json_build_object('status', e.status, 'detalhe', e.detalhe, 'em', e.criado_em) order by e.criado_em)
           from pedido_eventos e where e.pedido_id = p.id) as eventos,
        (select row_to_json(c) from pedido_cobrancas c where c.pedido_id = p.id) as cobranca,
        (select row_to_json(n) from pedido_notas n where n.pedido_id = p.id) as nota
         from pedidos p where p.id = $1 and p.cliente_id = $2`,
      [pedidoId, clienteId],
    );
    if (!ped.rows[0]) throw new NotFoundException('Pedido não encontrado');
    return ped.rows[0];
  }

  async repetir(clienteId: string, pedidoId: string) {
    const { pool } = tenantCtx();
    const carrinhoId = await this.carrinhoId({ clienteId });
    await pool.query(
      `insert into carrinho_itens (carrinho_id, produto_id, quantidade, preco_unit_snapshot)
       select $1, i.produto_id, i.quantidade, i.preco_unit
         from pedido_itens i
         join pedidos p on p.id = i.pedido_id and p.cliente_id = $2
         join produtos pr on pr.id = i.produto_id and pr.ativo
        where i.pedido_id = $3
       on conflict (carrinho_id, produto_id) do update set quantidade = excluded.quantidade`,
      [carrinhoId, clienteId, pedidoId],
    );
    return this.carrinho({ clienteId });
  }
}
