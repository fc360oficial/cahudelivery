import { Injectable, Logger } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { creditarIndicacao } from '../orders/creditar-indicacao';

export interface PedidoDlinks {
  codigo: string;
  numero: number;
  criadoEm: string;
  cliente: { documento: string; erpClienteId: string | null };
  tipoEntrega: string;
  endereco: Record<string, unknown> | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  itens: Array<{ erpProdutoId: string; quantidade: number; precoUnit: number }>;
  valorAbatidoSaldo: number;
}

export interface ResultadoLote {
  processados: string[];
  ignorados: Array<{ codigo: string; motivo: 'nao_encontrado' | 'status_invalido' | 'erro_interno' }>;
}

@Injectable()
export class DlinksPedidosService {
  private readonly log = new Logger('DlinksPedidosService');

  async listar(dataInicial: string, dataFinal: string): Promise<{ pedidos: PedidoDlinks[] }> {
    const { pool } = tenantCtx();
    const inicio = Date.now();
    const { rows } = await pool.query(
      `select p.id, p.numero, p.criado_em, p.tipo_entrega, p.forma_pagamento, p.condicao_pagamento,
              p.endereco_snapshot_json, p.valor_saldo_usado,
              c.documento, c.erp_cliente_id,
              (select json_agg(json_build_object(
                  'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                  'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i join produtos pr on pr.id = i.produto_id
                where i.pedido_id = p.id) as itens
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em >= ($1::date)::timestamp at time zone 'America/Recife'
          and p.criado_em < ($2::date + 1)::timestamp at time zone 'America/Recife'
        order by p.criado_em`,
      [dataInicial, dataFinal],
    );
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
       values ('consulta_pedidos','erp_para_fluxo',$1,$2,true,$3)`,
      [`${dataInicial} a ${dataFinal}`, `${rows.length} pedido(s)`, Date.now() - inicio],
    );
    return {
      pedidos: rows.map((r) => ({
        codigo: r.id,
        // pedidos.numero é bigint — node-pg devolve string, converter pro Dlinks receber número
        numero: Number(r.numero),
        criadoEm: r.criado_em,
        cliente: { documento: r.documento, erpClienteId: r.erp_cliente_id },
        tipoEntrega: r.tipo_entrega,
        endereco: r.endereco_snapshot_json,
        formaPagamento: r.forma_pagamento,
        condicaoPagamento: r.condicao_pagamento,
        itens: r.itens ?? [],
        valorAbatidoSaldo: Number(r.valor_saldo_usado) || 0,
      })),
    };
  }

  async marcarRecebido(codigos: string[]): Promise<ResultadoLote> {
    return this.transicionar(codigos, {
      statusPermitido: (status) => status === 'RECEBIDO',
      novoStatus: 'ENVIADO_ERP',
      detalhe: 'Confirmado pelo Dlinks',
      operacao: 'pedido_recebido',
    });
  }

  async marcarCancelado(codigos: string[]): Promise<ResultadoLote> {
    return this.transicionar(codigos, {
      statusPermitido: (status) => status !== 'ENTREGUE' && status !== 'CANCELADO',
      novoStatus: 'CANCELADO',
      detalhe: 'Cancelado pelo Dlinks',
      operacao: 'pedido_cancelado',
      estornarSaldo: true,
    });
  }

  /**
   * POST /pedidos-faturados: ABERTO/EM_FATURAMENTO ainda não têm status
   * nosso correspondente (o pedido já está em ENVIADO_ERP) — só registramos
   * no log de integração. CANCELADO reaproveita o mesmo caminho de
   * /pedidos/cancelado (estorno de saldo incluso). FATURADO credita a
   * indicação, se houver.
   */
  async marcarFaturado(pedidoCodigo: string, statusErp: string): Promise<ResultadoLote> {
    if (statusErp === 'CANCELADO') {
      return this.marcarCancelado([pedidoCodigo]);
    }
    if (statusErp !== 'FATURADO') {
      const { pool } = tenantCtx();
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ('pedido_faturado_status','erp_para_fluxo',$1,true)`,
        [`${pedidoCodigo}: ${statusErp}`],
      );
      return { processados: [pedidoCodigo], ignorados: [] };
    }
    return this.transicionar([pedidoCodigo], {
      statusPermitido: (status) => status !== 'FATURADO' && status !== 'CANCELADO' && status !== 'ENTREGUE',
      novoStatus: 'FATURADO',
      detalhe: 'Faturado pelo Dlinks',
      operacao: 'pedido_faturado',
      aposCommit: (client, codigo) => creditarIndicacao(client, codigo),
    });
  }

  /**
   * Aplica a transição de status de cada código dentro de uma transação com
   * `select ... for update`: o lock serializa chamadas concorrentes pro mesmo
   * pedido e mantém status + evento + estorno + log atômicos.
   */
  private async transicionar(
    codigos: string[],
    opts: {
      statusPermitido: (statusAtual: string) => boolean;
      novoStatus: string;
      detalhe: string;
      operacao: string;
      estornarSaldo?: boolean;
      aposCommit?: (client: import('pg').PoolClient, codigo: string) => Promise<void>;
    },
  ): Promise<ResultadoLote> {
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const atual = await client.query(
          `select status, cliente_id, valor_saldo_usado from pedidos where id = $1 for update`,
          [codigo],
        );
        if (!atual.rowCount) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'nao_encontrado' });
          continue;
        }
        if (!opts.statusPermitido(atual.rows[0].status)) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
        await client.query(`update pedidos set status = $2 where id = $1`, [codigo, opts.novoStatus]);
        await client.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'erp')`,
          [codigo, opts.novoStatus, opts.detalhe],
        );
        if (opts.estornarSaldo) {
          const valorSaldo = Number(atual.rows[0].valor_saldo_usado) || 0;
          if (valorSaldo > 0) {
            await client.query(
              `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1,$2,'Estorno: pedido cancelado pelo ERP',$3)`,
              [atual.rows[0].cliente_id, valorSaldo, codigo],
            );
          }
        }
        await client.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,true)`,
          [opts.operacao, codigo],
        );
        await client.query('commit');
        if (opts.aposCommit) await opts.aposCommit(client, codigo);
        processados.push(codigo);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        this.log.error(`${opts.operacao} falhou pro codigo ${codigo}: ${e}`);
        ignorados.push({ codigo, motivo: 'erro_interno' });
      } finally {
        client.release();
      }
    }
    return { processados, ignorados };
  }
}
