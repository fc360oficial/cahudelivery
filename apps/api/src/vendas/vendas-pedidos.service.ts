// apps/api/src/vendas/vendas-pedidos.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar, conferirPedido, DadosAtuais, Divergencia } from './conferir-pedido';
import { PedidoVendedorDto } from './pedido-vendedor.dto';

interface Consulta {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface PedidoResumo {
  id: string;
  numero: number;
  status: string;
  total: number;
  divergencias: Divergencia[];
}

export interface PedidoListado {
  id: string;
  numero: number;
  idDispositivo: string | null;
  clienteId: string;
  status: string;
  total: number;
  criadoEm: string;
  divergencias: Divergencia[];
}

/**
 * pedidos.forma_pagamento só aceita boleto/pix/cartao. A forma do ERP entra num
 * desses três: à vista = 'pix' (não consome crédito), cartão de crédito = 'cartao',
 * todo o resto a prazo = 'boleto' (confere limite de crédito).
 */
export function formaInterna(descricao: string): 'boleto' | 'pix' | 'cartao' {
  const d = descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/BOLETO/.test(d)) return 'boleto';
  if (/PIX|DINHEIRO|VISTA|DEBITO/.test(d)) return 'pix';
  if (/CART|CREDITO/.test(d)) return 'cartao';
  return 'boleto';
}

@Injectable()
export class VendasPedidosService {
  private async porIdDispositivo(q: Consulta, idDispositivo: string, vendedorId: string): Promise<PedidoResumo | null> {
    const { rows } = await q.query(
      `select p.id, p.numero, p.status, p.total, p.retencao_json, p.vendedor_id from pedidos p where p.id_dispositivo = $1`,
      [idDispositivo],
    );
    const p = rows[0];
    if (!p) return null;
    if (p.vendedor_id !== vendedorId) {
      throw new ConflictException({ statusCode: 409, message: 'Identificador de pedido já usado', codigo: 'ID_DISPOSITIVO_EM_USO' });
    }
    return {
      id: p.id, numero: Number(p.numero), status: p.status, total: Number(p.total),
      divergencias: p.status === 'AGUARDANDO_VENDEDOR' ? (p.retencao_json?.divergencias ?? []) : [],
    };
  }

  /** Cliente ainda na carteira do vendedor, cadastrado no ERP e liberado para novos pedidos (usado ao receber e ao confirmar). */
  private async conferirCliente(q: Consulta, clienteId: string, vendedorId: string): Promise<void> {
    const carteira = await q.query(
      `select c.status, c.erp_cliente_id from cliente_vendedor cv join clientes c on c.id = cv.cliente_id
        where cv.cliente_id = $1 and cv.vendedor_id = $2`,
      [clienteId, vendedorId],
    );
    if (!carteira.rowCount) {
      throw new ForbiddenException({ statusCode: 403, message: 'Cliente fora da sua carteira', codigo: 'CLIENTE_FORA_DA_CARTEIRA' });
    }
    if (!carteira.rows[0].erp_cliente_id) {
      throw new BadRequestException({ statusCode: 400, message: 'Cliente sem cadastro no ERP', codigo: 'CLIENTE_SEM_CADASTRO_ERP' });
    }
    if (carteira.rows[0].status === 'bloqueado' || carteira.rows[0].status === 'excluido') {
      throw new BadRequestException({ statusCode: 400, message: 'Cliente bloqueado para novos pedidos', codigo: 'CLIENTE_BLOQUEADO' });
    }
  }

  /**
   * A tabela vem do ERP e a forma precisa estar entre as aceitas por ela (tabela_preco_formas).
   * O prazo não entra aqui: ele está na própria tabela e o ERP monta o boleto a partir dela.
   */
  private async conferirTabelaForma(q: Consulta, tabelaId: string, formaId: string | null): Promise<'boleto' | 'pix' | 'cartao'> {
    const { rows } = await q.query(
      `/* tabela_forma */
       select fp.descricao as forma,
              exists (select 1 from tabelas_preco t where t.id = $2 and t.erp_tabela_id is not null) as tabela_existe,
              exists (select 1 from tabela_preco_formas x
                       where x.tabela_preco_id = $2 and x.forma_pagamento_id = fp.id) as permitida
         from formas_pagamento_erp fp
        where fp.id = $1`,
      [formaId, tabelaId],
    );
    const f = rows[0];
    if (!f || !f.tabela_existe) {
      throw new BadRequestException({ statusCode: 400, message: 'Tabela ou forma de pagamento inexistente', codigo: 'TABELA_OU_FORMA_INEXISTENTE' });
    }
    if (!f.permitida) {
      throw new BadRequestException({ statusCode: 400, message: 'Forma de pagamento não permitida para esta tabela', codigo: 'FORMA_NAO_PERMITIDA' });
    }
    return formaInterna(f.forma);
  }

  private async dadosAtuais(q: Consulta, clienteId: string, tabelaId: string, produtoIds: string[], exigeCredito: boolean): Promise<DadosAtuais> {
    const { rows } = await q.query(
      `/* dados_atuais */
       select p.id, p.nome, pr.preco, coalesce(e.quantidade,0) as estoque
         from produtos p
         left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $2
         left join estoques e on e.produto_id = p.id
        where p.id = any($1::uuid[]) and p.ativo`,
      [produtoIds, tabelaId],
    );
    if (rows.length !== produtoIds.length) throw new BadRequestException({ statusCode: 400, message: 'Produto inexistente ou inativo no pedido', codigo: 'PRODUTO_INDISPONIVEL' });
    const precos = new Map<string, number>();
    const estoques = new Map<string, number>();
    const nomes = new Map<string, string>();
    for (const r of rows) {
      if (r.preco != null) precos.set(r.id, Number(r.preco));
      estoques.set(r.id, Number(r.estoque));
      nomes.set(r.id, r.nome);
    }
    let creditoDisponivel: number | null = null;
    if (exigeCredito) {
      const lim = await q.query(`select limite_credito from clientes where id = $1`, [clienteId]);
      const limite = lim.rows[0]?.limite_credito;
      if (limite != null) {
        const aberto = await q.query(
          `select coalesce(sum(valor),0) as total from titulos_cliente where cliente_id = $1 and status = 'ABERTO'`,
          [clienteId],
        );
        // Pedido a prazo já aceito mas ainda sem título (RECEBIDO até EM_FATURAMENTO) também consome o limite;
        // de FATURADO em diante o título já cobre. O pedido retido é AGUARDANDO_VENDEDOR, então não conta contra si mesmo.
        const emTransito = await q.query(
          `/* em_transito */
           select coalesce(sum(total),0) as total from pedidos
            where cliente_id = $1 and forma_pagamento = 'boleto'
              and status in ('RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO')`,
          [clienteId],
        );
        creditoDisponivel = arredondar(Number(limite) - Number(aberto.rows[0].total) - Number(emTransito.rows[0]?.total ?? 0));
      }
    }
    return { precos, estoques, nomes, creditoDisponivel, exigeCredito };
  }

  async receber(vendedorId: string, dto: PedidoVendedorDto): Promise<PedidoResumo> {
    const { pool } = tenantCtx();
    const existente = await this.porIdDispositivo(pool, dto.idDispositivo, vendedorId);
    if (existente) return existente;

    await this.conferirCliente(pool, dto.clienteId, vendedorId);

    const produtoIds = dto.itens.map((i) => i.produtoId);
    if (new Set(produtoIds).size !== produtoIds.length) throw new BadRequestException({ statusCode: 400, message: 'Produto repetido no pedido', codigo: 'PRODUTO_REPETIDO' });

    const forma = await this.conferirTabelaForma(pool, dto.tabelaPrecoId, dto.formaPagamentoId);

    let enderecoJson: string | null = null;
    if (dto.tipoEntrega === 'entrega') {
      const end = await pool.query(
        `select * from cliente_enderecos where cliente_id = $1 order by padrao desc limit 1`,
        [dto.clienteId],
      );
      if (!end.rows[0]) throw new BadRequestException({ statusCode: 400, message: 'Cliente sem endereço cadastrado para entrega', codigo: 'SEM_ENDERECO' });
      enderecoJson = JSON.stringify(end.rows[0]);
    }

    const totalEnviado = arredondar(dto.itens.reduce((t, i) => t + arredondar(i.precoUnit * i.quantidade), 0));
    if (totalEnviado > 999999999) {
      throw new BadRequestException({ statusCode: 400, message: 'Valor do pedido fora do limite', codigo: 'VALOR_FORA_DO_LIMITE' });
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1::uuid::text))', [dto.clienteId]);
      const dados = await this.dadosAtuais(client, dto.clienteId, dto.tabelaPrecoId, produtoIds, forma === 'boleto');
      const { divergencias, totalAtual } = conferirPedido(dto.itens, dados);
      const retido = divergencias.length > 0;
      const total = retido ? totalEnviado : totalAtual;
      const status = retido ? 'AGUARDANDO_VENDEDOR' : 'RECEBIDO';
      const ped = await client.query(
        `insert into pedidos (cliente_id, endereco_snapshot_json, forma_pagamento, tipo_entrega, subtotal, total, observacoes,
                              condicao_pagamento, status, vendedor_id, origem, tabela_preco_id, forma_pagamento_erp_id,
                              id_dispositivo, retencao_json, criado_no_aparelho_em)
         values ($1,$2,$3,$4,$5,$5,$6,null,$7,$8,'vendedor',$9,$10,$11,$12,$13) returning id, numero`,
        [
          dto.clienteId, enderecoJson, forma, dto.tipoEntrega, total, dto.observacoes ?? null, status,
          vendedorId, dto.tabelaPrecoId, dto.formaPagamentoId, dto.idDispositivo,
          retido ? JSON.stringify({ divergencias, retidoEm: new Date().toISOString() }) : null,
          dto.criadoNoAparelhoEm,
        ],
      );
      const pedidoId = ped.rows[0].id;
      for (const i of dto.itens) {
        // Retido guarda o preço que o vendedor viu; liberado guarda o preço atual (iguais quando não há divergência).
        const preco = retido ? i.precoUnit : (dados.precos.get(i.produtoId) as number);
        await client.query(
          `insert into pedido_itens (pedido_id, produto_id, descricao_snapshot, quantidade, preco_unit, total)
           values ($1,$2,$3,$4,$5,$6)`,
          [pedidoId, i.produtoId, dados.nomes.get(i.produtoId), i.quantidade, preco, arredondar(preco * i.quantidade)],
        );
      }
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'app')`,
        [pedidoId, status, retido ? 'Pedido do vendedor retido: aguardando confirmação' : 'Pedido recebido do vendedor'],
      );
      if (!retido) {
        await client.query(
          `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
          [pedidoId],
        );
      }
      if (dto.orcamentoId) {
        await client.query(
          `update orcamentos set status = 'convertido', pedido_id = $1, atualizado_em = now()
            where id = $2 and vendedor_id = $3 and status = 'aberto'`,
          [pedidoId, dto.orcamentoId, vendedorId],
        );
      }
      await client.query('commit');
      return { id: pedidoId, numero: Number(ped.rows[0].numero), status, total, divergencias };
    } catch (e) {
      await client.query('rollback');
      // Dois envios simultâneos do mesmo pedido: o segundo bate no índice único e devolve o primeiro.
      if ((e as { code?: string }).code === '23505') {
        const ja = await this.porIdDispositivo(pool, dto.idDispositivo, vendedorId);
        if (ja) return ja;
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /** Vendedor aceita os preços atuais. Estoque, crédito e falta de preço continuam barrando. */
  async confirmar(vendedorId: string, pedidoId: string): Promise<PedidoResumo> {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const ped = await client.query(
        `/* pedido_retido */
         select id, numero, cliente_id, tabela_preco_id, forma_pagamento_erp_id
           from pedidos where id = $1 and vendedor_id = $2 and status = 'AGUARDANDO_VENDEDOR' for update`,
        [pedidoId, vendedorId],
      );
      const p = ped.rows[0];
      if (!p) throw new NotFoundException('Pedido não encontrado ou já resolvido');
      await client.query('select pg_advisory_xact_lock(hashtext($1::uuid::text))', [p.cliente_id]);
      await this.conferirCliente(client, p.cliente_id, vendedorId);
      const itens = await client.query(
        `/* itens_retidos */ select produto_id, quantidade, preco_unit from pedido_itens where pedido_id = $1`,
        [pedidoId],
      );
      const produtoIds = itens.rows.map((i) => i.produto_id);
      const forma = await this.conferirTabelaForma(client, p.tabela_preco_id, p.forma_pagamento_erp_id);
      const dados = await this.dadosAtuais(client, p.cliente_id, p.tabela_preco_id, produtoIds, forma === 'boleto');
      const aceitos = itens.rows.map((i) => ({
        produtoId: i.produto_id as string,
        quantidade: Number(i.quantidade),
        precoUnit: dados.precos.get(i.produto_id) ?? Number(i.preco_unit),
      }));
      const { divergencias, totalAtual } = conferirPedido(aceitos, dados);
      if (divergencias.length) {
        throw new ConflictException({
          statusCode: 409, message: 'O pedido ainda tem pendência de estoque ou crédito', codigo: 'AINDA_DIVERGENTE', divergencias,
        });
      }
      for (const i of aceitos) {
        await client.query(
          `update pedido_itens set preco_unit = $3, total = $4 where pedido_id = $1 and produto_id = $2`,
          [pedidoId, i.produtoId, i.precoUnit, arredondar(i.precoUnit * i.quantidade)],
        );
      }
      // criado_em = now(): o ERP busca pedidos por data de criação; sem isso perderia um pedido retido ontem.
      await client.query(
        `update pedidos set status = 'RECEBIDO', subtotal = $2, total = $2, criado_em = now(),
                retencao_json = coalesce(retencao_json, '{}'::jsonb) || jsonb_build_object('confirmadoEm', now())
          where id = $1`,
        [pedidoId, totalAtual],
      );
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'RECEBIDO','Vendedor confirmou os valores atuais','app')`,
        [pedidoId],
      );
      await client.query(
        `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
        [pedidoId],
      );
      await client.query('commit');
      return { id: pedidoId, numero: Number(p.numero), status: 'RECEBIDO', total: totalAtual, divergencias: [] };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async cancelar(vendedorId: string, pedidoId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `with c as (
         update pedidos set status = 'CANCELADO'
          where id = $1 and vendedor_id = $2 and status = 'AGUARDANDO_VENDEDOR' returning id)
       insert into pedido_eventos (pedido_id, status, detalhe, origem)
       select id, 'CANCELADO', 'Vendedor cancelou o pedido retido', 'app' from c`,
      [pedidoId, vendedorId],
    );
    if (!rowCount) throw new NotFoundException('Pedido não encontrado ou já resolvido');
    // Orçamento que virou este pedido volta a ficar aberto.
    await pool.query(
      `update orcamentos set status = 'aberto', pedido_id = null, atualizado_em = now()
        where pedido_id = $1 and vendedor_id = $2 and status = 'convertido'`,
      [pedidoId, vendedorId],
    );
    return { ok: true };
  }

  async listar(vendedorId: string): Promise<PedidoListado[]> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, numero, id_dispositivo, cliente_id, status, total, criado_em, retencao_json
         from pedidos
        where vendedor_id = $1 and criado_em > now() - interval '60 days'
        order by criado_em desc`,
      [vendedorId],
    );
    return rows.map((r) => ({
      id: r.id, numero: Number(r.numero), idDispositivo: r.id_dispositivo, clienteId: r.cliente_id, status: r.status,
      total: Number(r.total), criadoEm: r.criado_em,
      divergencias: r.status === 'AGUARDANDO_VENDEDOR' ? (r.retencao_json?.divergencias ?? []) : [],
    }));
  }
}
