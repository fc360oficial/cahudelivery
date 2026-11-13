import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import { DevolucaoDto } from './devolucao.dto';
import type { ResultadoSync } from './dlinks-sync.service';
import { FuncionarioDto } from './funcionario.dto';
import { VendaVendedorDto } from './venda-vendedor.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DlinksVendedoresService {
  private async registrarLog(operacao: string, resumo: string, sucesso: boolean) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,$3)`,
      [operacao, resumo, sucesso],
    );
  }

  /** Vendedor é identificado pelo código do ERP. `ativo` ausente não mexe no que a retaguarda definiu. */
  async syncFuncionarios(itens: FuncionarioDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into vendedores (erp_vendedor_id, nome, filial, ativo)
         values ($1, $2, $3, coalesce($4::boolean, true))
         on conflict (erp_vendedor_id) do update set
           nome = excluded.nome,
           filial = coalesce(excluded.filial, vendedores.filial),
           ativo = coalesce($4::boolean, vendedores.ativo)`,
        [item.codigo, item.nome, item.filial_codigo ?? null, item.ativo ?? null],
      );
      processados++;
    }
    await this.registrarLog('sync_funcionarios', `${processados} vendedor(es)`, true);
    return { processados, ignorados: [] };
  }

  /**
   * Faturado do mês por vendedor (base da meta). Upsert por (vendedor, mês): reenviar o mês corrige o valor.
   * Vendedor desconhecido é ignorado com `funcionario_nao_encontrado`.
   */
  async syncFaturamentoMensal(itens: VendaVendedorDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    let processados = 0;
    for (const item of itens) {
      const vend = await pool.query(`select id from vendedores where erp_vendedor_id = $1`, [item.funcionario_codigo]);
      if (!vend.rowCount) {
        ignorados.push({ item, motivo: 'funcionario_nao_encontrado' });
        continue;
      }
      await pool.query(
        `insert into vendedor_faturamento_mensal (vendedor_id, ano_mes, valor)
         values ($1, $2, $3)
         on conflict (vendedor_id, ano_mes) do update set valor = excluded.valor, atualizado_em = now()`,
        [vend.rows[0].id, item.ano_mes, item.valor_faturado],
      );
      processados++;
    }
    await this.registrarLog('sync_vendas_vendedores', `${processados} mês(es) de vendedor, ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados, ignorados };
  }

  /**
   * Devoluções de venda. Upsert pela nota de devolução (numero_nota + serie): reenviar corrige valor/data/cancelamento.
   * O vendedor é o do pedido (`pedido_codigo`); sem pedido, o de `funcionario_codigo`. Devolução de pedido que não é
   * de vendedor (ex.: do aplicativo do cliente) é ignorada: não há venda de vendedor para abater.
   */
  async syncDevolucoes(itens: DevolucaoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    let processados = 0;
    for (const item of itens) {
      let pedidoId: string | null = null;
      let vendedorId: string | null = null;
      let clienteId: string | null = null;
      if (item.pedido_codigo) {
        if (!UUID.test(item.pedido_codigo)) {
          ignorados.push({ item, motivo: 'pedido_nao_encontrado' });
          continue;
        }
        const ped = await pool.query(`select id, vendedor_id, cliente_id from pedidos where id = $1`, [item.pedido_codigo]);
        if (!ped.rowCount) {
          ignorados.push({ item, motivo: 'pedido_nao_encontrado' });
          continue;
        }
        pedidoId = ped.rows[0].id;
        vendedorId = ped.rows[0].vendedor_id ?? null;
        clienteId = ped.rows[0].cliente_id ?? null;
        if (!vendedorId && !item.funcionario_codigo) {
          ignorados.push({ item, motivo: 'pedido_sem_vendedor' });
          continue;
        }
      }
      if (!vendedorId) {
        if (!item.funcionario_codigo) {
          ignorados.push({ item, motivo: 'sem_pedido_nem_funcionario' });
          continue;
        }
        const vend = await pool.query(`select id from vendedores where erp_vendedor_id = $1`, [item.funcionario_codigo]);
        if (!vend.rowCount) {
          ignorados.push({ item, motivo: 'funcionario_nao_encontrado' });
          continue;
        }
        vendedorId = vend.rows[0].id;
      }
      if (!clienteId && item.cliente_codigo) {
        const cli = await pool.query(`select id from clientes where erp_cliente_id = $1`, [item.cliente_codigo]);
        clienteId = cli.rows[0]?.id ?? null;
      }
      await pool.query(
        `insert into devolucoes_venda (numero_nota, serie, vendedor_id, pedido_id, cliente_id, nota_venda, valor, devolvido_em, cancelada)
         values ($1, $2, $3, $4, $5, $6, $7,
                 -- data sem hora = o dia no calendário de Recife (senão cairia no dia anterior, e no mês anterior no dia 1º)
                 case when $8::text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                      then ($8::date)::timestamp at time zone 'America/Recife'
                      else $8::timestamptz end,
                 coalesce($9::boolean, false))
         on conflict (numero_nota, serie) do update set
           vendedor_id = excluded.vendedor_id, pedido_id = excluded.pedido_id, cliente_id = excluded.cliente_id,
           nota_venda = excluded.nota_venda, valor = excluded.valor, devolvido_em = excluded.devolvido_em,
           cancelada = excluded.cancelada, atualizado_em = now()`,
        [item.numero_nota, item.serie ?? '', vendedorId, pedidoId, clienteId, item.nota_venda_numero ?? null, item.valor, item.data, item.cancelada ?? null],
      );
      processados++;
    }
    await this.registrarLog('sync_devolucoes', `${processados} devolução(ões), ${ignorados.length} ignorada(s)`, ignorados.length === 0);
    return { processados, ignorados };
  }

  /**
   * O lote manda nos clientes que cita: os vínculos antigos desses clientes são
   * apagados e os do lote entram. Cliente que não aparece no lote não é tocado.
   * Todos os vendedores de um cliente precisam vir na mesma chamada. Cliente enviado com
   * funcionario_codigo vazio ou nulo é removido de todas as carteiras.
   */
  async syncCarteira(itens: ClienteFuncionarioDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    const pares: Array<[string, string]> = [];
    const semVendedor = new Set<string>();
    for (const item of itens) {
      const cli = await pool.query(`select id from clientes where erp_cliente_id = $1`, [item.cliente_codigo]);
      if (!cli.rowCount) {
        ignorados.push({ item, motivo: 'cliente_nao_encontrado' });
        continue;
      }
      if (!item.funcionario_codigo) {
        semVendedor.add(cli.rows[0].id);
        continue;
      }
      const vend = await pool.query(`select id from vendedores where erp_vendedor_id = $1`, [item.funcionario_codigo]);
      if (!vend.rowCount) {
        ignorados.push({ item, motivo: 'funcionario_nao_encontrado' });
        continue;
      }
      pares.push([cli.rows[0].id, vend.rows[0].id]);
    }
    if (pares.length || semVendedor.size) {
      const clientes = [...new Set([...pares.map(([c]) => c), ...semVendedor])];
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`delete from cliente_vendedor where cliente_id = any($1::uuid[])`, [clientes]);
        for (const [clienteId, vendedorId] of pares) {
          await client.query(
            `insert into cliente_vendedor (cliente_id, vendedor_id) values ($1, $2) on conflict do nothing`,
            [clienteId, vendedorId],
          );
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    }
    await this.registrarLog('sync_carteira', `${pares.length} vínculo(s), ${semVendedor.size} cliente(s) sem vendedor, ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados: pares.length + semVendedor.size, ignorados };
  }
}
