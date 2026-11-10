import { NotFoundException } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { Pool } from 'pg';

/** Corpo de PUT produtos/:id/imagem (Delivery e Vendas). */
export class ImagemProdutoDto {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsString() urlMiniatura?: string;
}

/**
 * Foto de capa do produto: pertence ao produto (catálogo compartilhado), não a um painel.
 * Usada pelas rotas de Delivery e de Vendas.
 */
export async function definirImagemProduto(pool: Pool, produtoId: string, url: string, usuarioId: string, urlMiniatura?: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // Serializa por produto: evita 2 uploads simultâneos criarem 2 linhas de capa (ordem=0).
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [produtoId]);
    const produto = await client.query(`select 1 from produtos where id = $1`, [produtoId]);
    if (!produto.rowCount) throw new NotFoundException('Produto não encontrado');
    const capa = await client.query(
      `select id from produto_imagens where produto_id = $1 order by ordem asc limit 1`,
      [produtoId],
    );
    if (capa.rowCount) {
      await client.query(`update produto_imagens set url = $2, url_miniatura = $3 where id = $1`, [capa.rows[0].id, url, urlMiniatura ?? null]);
    } else {
      await client.query(
        `insert into produto_imagens (produto_id, url, url_miniatura, ordem, origem) values ($1, $2, $3, 0, 'retaguarda')`,
        [produtoId, url, urlMiniatura ?? null],
      );
    }
    await client.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'definir_imagem_produto','produto',$2,$3)`,
      [usuarioId, produtoId, JSON.stringify({ url })],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return { ok: true };
}

export async function removerImagemProduto(pool: Pool, produtoId: string, usuarioId: string) {
  const produto = await pool.query(`select 1 from produtos where id = $1`, [produtoId]);
  if (!produto.rowCount) throw new NotFoundException('Produto não encontrado');
  await pool.query(
    `delete from produto_imagens where id = (
       select id from produto_imagens where produto_id = $1 order by ordem asc limit 1
     )`,
    [produtoId],
  );
  await pool.query(
    `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
     values ($1,'remover_imagem_produto','produto',$2,$3)`,
    [usuarioId, produtoId, JSON.stringify({})],
  );
  return { ok: true };
}
