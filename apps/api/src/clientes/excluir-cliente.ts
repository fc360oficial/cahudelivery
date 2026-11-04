import { NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';

/**
 * Exclui um cliente, pela retaguarda ou a pedido dele no app. Sem histórico:
 * apaga a linha de verdade (limpa endereços, credenciais, carrinho, dispositivos
 * e inbox antes). Com pedido, carteira ou indicados, a nota fiscal e o histórico
 * de venda referenciam o cliente: anonimiza os dados pessoais e marca status
 * 'excluido' (login bloqueado). Cliente do ERP também fica como 'excluido': é a
 * linha que impede o sync do Dlinks de recriar a conta pelo documento.
 */
export async function excluirCliente(pool: Pool, id: string, usuarioId: string | null, origem: 'retaguarda' | 'cliente') {
  const cliente = await pool.query(`select id, erp_cliente_id from clientes where id = $1`, [id]);
  if (!cliente.rows[0]) throw new NotFoundException('Cliente não encontrado');
  const temPedido = await pool.query(`select 1 from pedidos where cliente_id = $1 limit 1`, [id]);
  const temCarteira = await pool.query(`select 1 from carteira_movimentos where cliente_id = $1 limit 1`, [id]);
  const temIndicados = await pool.query(`select 1 from clientes where indicado_por_cliente_id = $1 limit 1`, [id]);
  const preservarCliente = temPedido.rowCount || temCarteira.rowCount || temIndicados.rowCount || cliente.rows[0].erp_cliente_id;

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
    await client.query(`delete from cliente_codigos_acesso where cliente_id = $1`, [id]);
    await client.query(`delete from dispositivos where cliente_id = $1`, [id]);
    await client.query(`delete from notificacao_entregas where cliente_id = $1`, [id]);
    await client.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'cliente'`, [id]);
    await client.query(`delete from favoritos where cliente_id = $1`, [id]);
    await client.query(`delete from solicitacoes_credito where cliente_id = $1`, [id]);

    if (preservarCliente) {
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
      [usuarioId, id, JSON.stringify({ removidoDeVerdade: !preservarCliente, origem })],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { ok: true, removidoDeVerdade: !preservarCliente };
}
