import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard } from './admin.guard';

class PatrocinadorProdutoDto {
  @IsUUID() produtoId!: string;
  @IsOptional() @IsNumber() @Min(0) precoEspecial?: number;
}

class PatrocinadorDto {
  @IsNotEmpty() nome!: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() bannerUrl?: string;
  @IsOptional() @IsUUID() aposCategoriaId?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsArray() @Type(() => PatrocinadorProdutoDto) produtos!: PatrocinadorProdutoDto[];
}

/** CRUD das vitrines patrocinadas (indústria/fabricante), gerenciado pela retaguarda. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminPatrocinadoresController {
  @Get('patrocinadores')
  async listar() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select pat.id, pat.nome, pat.logo_url, pat.banner_url, pat.apos_categoria_id, pat.ativo,
              (select nome from categorias where id = pat.apos_categoria_id) as apos_categoria_nome,
              (select json_agg(json_build_object('produtoId', pp.produto_id, 'nome', pr.nome, 'sku', pr.sku,
                  'precoEspecial', pp.preco_especial) order by pp.ordem)
                 from patrocinador_produtos pp join produtos pr on pr.id = pp.produto_id
                where pp.patrocinador_id = pat.id) as produtos
         from patrocinadores pat order by pat.criado_em desc`,
    );
    return rows;
  }

  @Post('patrocinadores')
  async criar(@Body() dto: PatrocinadorDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into patrocinadores (nome, logo_url, banner_url, apos_categoria_id, ativo)
         values ($1,$2,$3,$4,coalesce($5,true)) returning id`,
        [dto.nome, dto.logoUrl ?? null, dto.bannerUrl ?? null, dto.aposCategoriaId ?? null, dto.ativo],
      );
      for (const [i, p] of dto.produtos.entries()) {
        await client.query(
          `insert into patrocinador_produtos (patrocinador_id, produto_id, preco_especial, ordem)
           values ($1,$2,$3,$4)`,
          [rows[0].id, p.produtoId, p.precoEspecial ?? null, i],
        );
      }
      await client.query('commit');
      return { id: rows[0].id };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  @Put('patrocinadores/:id')
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatrocinadorDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(
        `update patrocinadores set nome=$2, logo_url=$3, banner_url=$4, apos_categoria_id=$5,
                ativo=coalesce($6,ativo), atualizado_em=now()
          where id=$1 returning id`,
        [id, dto.nome, dto.logoUrl ?? null, dto.bannerUrl ?? null, dto.aposCategoriaId ?? null, dto.ativo],
      );
      if (!r.rowCount) throw new NotFoundException();
      await client.query(`delete from patrocinador_produtos where patrocinador_id = $1`, [id]);
      for (const [i, p] of dto.produtos.entries()) {
        await client.query(
          `insert into patrocinador_produtos (patrocinador_id, produto_id, preco_especial, ordem)
           values ($1,$2,$3,$4)`,
          [id, p.produtoId, p.precoEspecial ?? null, i],
        );
      }
      await client.query('commit');
      return { ok: true };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  @Delete('patrocinadores/:id')
  async remover(@Param('id', ParseUUIDPipe) id: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from patrocinador_produtos where patrocinador_id = $1`, [id]);
    await pool.query(`delete from patrocinadores where id = $1`, [id]);
    return { ok: true };
  }
}