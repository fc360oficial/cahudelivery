// apps/api/src/vendas/vendas-orcamentos.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar } from './conferir-pedido';
import { OrcamentoDto } from './orcamento.dto';
import { conferirTabelaForma } from './vendas-pedidos.service';

export interface OrcamentoListado {
  id: string;
  clienteId: string;
  tabelaPrecoId: string;
  formaPagamentoId: string | null;
  tipoEntrega: string;
  observacoes: string | null;
  total: number;
  status: string;
  pedidoId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: Array<{ produtoId: string; quantidade: number; precoUnit: number }>;
}

/** Orçamento vive fora de `pedidos`: o ERP nunca o vê. Vira pedido quando o app envia o pedido com `orcamentoId`. */
@Injectable()
export class VendasOrcamentosService {
  async salvar(vendedorId: string, id: string, dto: OrcamentoDto) {
    const { pool } = tenantCtx();
    const carteira = await pool.query(
      `select 1 from cliente_vendedor where cliente_id = $1 and vendedor_id = $2`,
      [dto.clienteId, vendedorId],
    );
    if (!carteira.rowCount) {
      throw new ForbiddenException({ statusCode: 403, message: 'Cliente fora da sua carteira', codigo: 'CLIENTE_FORA_DA_CARTEIRA' });
    }
    const tab = await pool.query(`/* tabela_tipo */ select tipo_entrega from tabelas_preco where id = $1`, [dto.tabelaPrecoId]);
    if (!tab.rows[0]) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Produto, tabela ou forma de pagamento não existe mais. Sincronize o aplicativo.',
        codigo: 'REFERENCIA_INVALIDA',
      });
    }
    // A tabela de preço define se é entrega ou retirada; o app não escolhe.
    const tipoEntrega: 'entrega' | 'retirada' = tab.rows[0].tipo_entrega === 'retirada' ? 'retirada' : 'entrega';
    if (dto.tipoEntrega && dto.tipoEntrega !== tipoEntrega) {
      throw new BadRequestException({ statusCode: 400, message: `Esta tabela é de ${tipoEntrega}`, codigo: 'TIPO_ENTREGA_DIFERENTE_DA_TABELA' });
    }
    // Orçamento sem forma é permitido; com forma, vale a mesma regra do pedido (a tabela precisa aceitá-la).
    if (dto.formaPagamentoId) await conferirTabelaForma(pool, dto.tabelaPrecoId, dto.formaPagamentoId);
    const produtoIds = dto.itens.map((i) => i.produtoId);
    if (new Set(produtoIds).size !== produtoIds.length) throw new BadRequestException('Produto repetido no orçamento');
    const total = arredondar(dto.itens.reduce((t, i) => t + arredondar(i.precoUnit * i.quantidade), 0));
    if (total > 999999999) {
      throw new BadRequestException({ statusCode: 400, message: 'Valor do orçamento fora do limite', codigo: 'VALOR_FORA_DO_LIMITE' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const gravado = await client.query(
        `insert into orcamentos (id, vendedor_id, cliente_id, tabela_preco_id, forma_pagamento_erp_id, tipo_entrega, observacoes, total)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set
           cliente_id = excluded.cliente_id, tabela_preco_id = excluded.tabela_preco_id,
           forma_pagamento_erp_id = excluded.forma_pagamento_erp_id, tipo_entrega = excluded.tipo_entrega,
           observacoes = excluded.observacoes, total = excluded.total, atualizado_em = now()
         where orcamentos.vendedor_id = excluded.vendedor_id and orcamentos.status = 'aberto'`,
        [id, vendedorId, dto.clienteId, dto.tabelaPrecoId, dto.formaPagamentoId ?? null, tipoEntrega, dto.observacoes ?? null, total],
      );
      if (!gravado.rowCount) {
        throw new ConflictException({ statusCode: 409, message: 'Este orçamento não pode mais ser alterado', codigo: 'ORCAMENTO_FECHADO' });
      }
      await client.query(`delete from orcamento_itens where orcamento_id = $1`, [id]);
      for (const i of dto.itens) {
        await client.query(
          `insert into orcamento_itens (orcamento_id, produto_id, quantidade, preco_unit) values ($1,$2,$3,$4)`,
          [id, i.produtoId, i.quantidade, i.precoUnit],
        );
      }
      await client.query('commit');
      return { id, status: 'aberto' as const, total };
    } catch (e) {
      await client.query('rollback');
      // Catálogo desatualizado no celular: produto, tabela ou forma de pagamento já não existem no cadastro.
      if ((e as { code?: string }).code === '23503') {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Produto, tabela ou forma de pagamento não existe mais. Sincronize o aplicativo.',
          codigo: 'REFERENCIA_INVALIDA',
        });
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async listar(vendedorId: string): Promise<OrcamentoListado[]> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select o.id, o.cliente_id, o.tabela_preco_id, o.forma_pagamento_erp_id, o.tipo_entrega, o.observacoes, o.total,
              o.status, o.pedido_id, o.criado_em, o.atualizado_em,
              (select json_agg(json_build_object('produtoId', i.produto_id, 'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from orcamento_itens i where i.orcamento_id = o.id) as itens
         from orcamentos o
        where o.vendedor_id = $1 and (o.status = 'aberto' or o.atualizado_em > now() - interval '60 days')
        order by o.atualizado_em desc`,
      [vendedorId],
    );
    return rows.map((o) => ({
      id: o.id, clienteId: o.cliente_id, tabelaPrecoId: o.tabela_preco_id, formaPagamentoId: o.forma_pagamento_erp_id,
      tipoEntrega: o.tipo_entrega, observacoes: o.observacoes, total: Number(o.total), status: o.status, pedidoId: o.pedido_id,
      criadoEm: o.criado_em, atualizadoEm: o.atualizado_em,
      itens: (o.itens ?? []).map((i: { produtoId: string; quantidade: unknown; precoUnit: unknown }) => ({
        produtoId: i.produtoId, quantidade: Number(i.quantidade), precoUnit: Number(i.precoUnit),
      })),
    }));
  }

  async cancelar(vendedorId: string, id: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `update orcamentos set status = 'cancelado', atualizado_em = now() where id = $1 and vendedor_id = $2 and status = 'aberto'`,
      [id, vendedorId],
    );
    if (!rowCount) throw new NotFoundException('Orçamento não encontrado ou já fechado');
    return { ok: true };
  }
}
