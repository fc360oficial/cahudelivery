import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import type { ResultadoSync } from './dlinks-sync.service';
import { FuncionarioDto } from './funcionario.dto';

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
   * O lote manda nos clientes que cita: os vínculos antigos desses clientes são
   * apagados e os do lote entram. Cliente que não aparece no lote não é tocado.
   */
  async syncCarteira(itens: ClienteFuncionarioDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    const pares: Array<[string, string]> = [];
    for (const item of itens) {
      const cli = await pool.query(`select id from clientes where erp_cliente_id = $1`, [item.cliente_codigo]);
      if (!cli.rowCount) {
        ignorados.push({ item, motivo: 'cliente_nao_encontrado' });
        continue;
      }
      const vend = await pool.query(`select id from vendedores where erp_vendedor_id = $1`, [item.funcionario_codigo]);
      if (!vend.rowCount) {
        ignorados.push({ item, motivo: 'funcionario_nao_encontrado' });
        continue;
      }
      pares.push([cli.rows[0].id, vend.rows[0].id]);
    }
    if (pares.length) {
      const clientes = [...new Set(pares.map(([c]) => c))];
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
    await this.registrarLog('sync_carteira', `${pares.length} vínculo(s), ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados: pares.length, ignorados };
  }
}
