import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import type { ResultadoSync } from './dlinks-sync.service';
import { FuncionarioDto } from './funcionario.dto';
import { VendaVendedorDto } from './venda-vendedor.dto';

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
