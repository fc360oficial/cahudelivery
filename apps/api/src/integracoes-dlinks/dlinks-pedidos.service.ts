import { Injectable, Logger } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';

export interface PedidoDlinks {
  codigo: string;
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
    const { rows } = await pool.query(
      `select p.id, p.criado_em, p.tipo_entrega, p.forma_pagamento, p.condicao_pagamento,
              p.endereco_snapshot_json, p.valor_saldo_usado,
              c.documento, c.erp_cliente_id,
              (select json_agg(json_build_object(
                  'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                  'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i join produtos pr on pr.id = i.produto_id
                where i.pedido_id = p.id) as itens
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em::date between $1 and $2
        order by p.criado_em`,
      [dataInicial, dataFinal],
    );
    return {
      pedidos: rows.map((r) => ({
        codigo: r.id,
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
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      try {
        const atual = await pool.query(`select status from pedidos where id = $1`, [codigo]);
        if (!atual.rowCount) {
          ignorados.push({ codigo, motivo: 'nao_encontrado' });
          continue;
        }
        if (atual.rows[0].status !== 'RECEBIDO') {
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
        await pool.query(`update pedidos set status = 'ENVIADO_ERP' where id = $1`, [codigo]);
        await pool.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'ENVIADO_ERP','Confirmado pelo Dlinks','erp')`,
          [codigo],
        );
        await pool.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ('pedido_recebido','erp_para_fluxo',$1,true)`,
          [codigo],
        );
        processados.push(codigo);
      } catch (e) {
        this.log.error(`marcarRecebido ${codigo}: ${e}`);
        ignorados.push({ codigo, motivo: 'erro_interno' });
      }
    }
    return { processados, ignorados };
  }

  async marcarCancelado(codigos: string[]): Promise<ResultadoLote> {
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      try {
        const atual = await pool.query(`select status from pedidos where id = $1`, [codigo]);
        if (!atual.rowCount) {
          ignorados.push({ codigo, motivo: 'nao_encontrado' });
          continue;
        }
        if (atual.rows[0].status === 'ENTREGUE') {
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
        await pool.query(`update pedidos set status = 'CANCELADO' where id = $1`, [codigo]);
        await pool.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO','Cancelado pelo Dlinks','erp')`,
          [codigo],
        );
        await pool.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ('pedido_cancelado','erp_para_fluxo',$1,true)`,
          [codigo],
        );
        processados.push(codigo);
      } catch (e) {
        this.log.error(`marcarCancelado falhou pro codigo ${codigo}: ${e}`);
        ignorados.push({ codigo, motivo: 'erro_interno' });
      }
    }
    return { processados, ignorados };
  }
}
