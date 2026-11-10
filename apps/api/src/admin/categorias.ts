import { NotFoundException } from '@nestjs/common';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { tenantCtx } from '../tenancy/tenant-context';

/**
 * Categorias do catálogo. Uma só tabela para o Delivery (/admin/categorias) e para o painel de Vendas
 * (/admin/vendas/categorias): os dois controllers só delegam para estas funções.
 */
export class CategoriaDto {
  @IsNotEmpty() nome!: string;
  @IsOptional() @IsUUID() paiId?: string;
  @IsOptional() @IsString() imagemUrl?: string;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

export const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export async function listarCategorias() {
  const { pool } = tenantCtx();
  const { rows } = await pool.query(
    `select c.id, c.pai_id, c.nome, c.slug, c.imagem_url, c.ordem, c.ativo,
            (select count(*)::int from produtos p where p.categoria_id = c.id) as produtos
       from categorias c order by c.ordem, c.nome`,
  );
  return rows;
}

export async function criarCategoria(dto: CategoriaDto) {
  const { pool } = tenantCtx();
  const { rows } = await pool.query(
    `insert into categorias (nome, slug, pai_id, imagem_url, ordem, ativo)
     values ($1,$2,$3,$4,coalesce($5,0),coalesce($6,true)) returning *`,
    [dto.nome, `${slug(dto.nome)}-${Date.now().toString(36)}`, dto.paiId ?? null, dto.imagemUrl ?? null, dto.ordem, dto.ativo],
  );
  return rows[0];
}

export async function editarCategoria(id: string, dto: CategoriaDto) {
  const { pool } = tenantCtx();
  const { rows } = await pool.query(
    // imagemUrl ausente = mantém a atual; '' = remove. (Antes, Ativar/Desativar apagava a foto.)
    `update categorias set nome=$2, pai_id=$3, imagem_url=case when $7 then imagem_url else $4 end,
            ordem=coalesce($5,ordem), ativo=coalesce($6,ativo)
      where id=$1 returning *`,
    [id, dto.nome, dto.paiId ?? null, dto.imagemUrl || null, dto.ordem, dto.ativo, dto.imagemUrl === undefined],
  );
  if (!rows[0]) throw new NotFoundException();
  return rows[0];
}
