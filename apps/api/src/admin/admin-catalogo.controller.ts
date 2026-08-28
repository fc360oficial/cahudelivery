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
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard } from './admin.guard';

class CategoriaDto {
  @IsNotEmpty() nome!: string;
  @IsOptional() @IsUUID() paiId?: string;
  @IsOptional() @IsString() imagemUrl?: string;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class MarcaDto {
  @IsNotEmpty() nome!: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class PromocaoProdutoDto {
  @IsUUID() produtoId!: string;
  @IsNumber() @Min(0) precoPromocional!: number;
}

class PromocaoDto {
  @IsNotEmpty() nome!: string;
  @IsNotEmpty() inicioEm!: string;
  @IsNotEmpty() fimEm!: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PromocaoProdutoDto) produtos!: PromocaoProdutoDto[];
}

class BannerDto {
  @IsOptional() @IsString() titulo?: string;
  @IsNotEmpty() imagemUrl!: string;
  @IsOptional() @IsIn(['produto', 'categoria', 'promocao', 'url']) destinoTipo?: string;
  @IsOptional() @IsString() destinoId?: string;
  @IsOptional() @IsInt() ordem?: number;
  @IsOptional() @IsString() inicioEm?: string;
  @IsOptional() @IsString() fimEm?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
}

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** CRUD do catálogo gerenciado pela retaguarda (categorias, marcas, promoções, banners). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminCatalogoController {
  // ---------- Categorias ----------
  @Get('categorias')
  async categorias() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select c.id, c.pai_id, c.nome, c.slug, c.imagem_url, c.ordem, c.ativo,
              (select count(*)::int from produtos p where p.categoria_id = c.id) as produtos
         from categorias c order by c.ordem, c.nome`,
    );
    return rows;
  }

  @Post('categorias')
  async criarCategoria(@Body() dto: CategoriaDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into categorias (nome, slug, pai_id, imagem_url, ordem, ativo)
       values ($1,$2,$3,$4,coalesce($5,0),coalesce($6,true)) returning *`,
      [dto.nome, `${slug(dto.nome)}-${Date.now().toString(36)}`, dto.paiId ?? null, dto.imagemUrl ?? null, dto.ordem, dto.ativo],
    );
    return rows[0];
  }

  @Put('categorias/:id')
  async editarCategoria(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoriaDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `update categorias set nome=$2, pai_id=$3, imagem_url=$4, ordem=coalesce($5,ordem), ativo=coalesce($6,ativo)
        where id=$1 returning *`,
      [id, dto.nome, dto.paiId ?? null, dto.imagemUrl ?? null, dto.ordem, dto.ativo],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  // ---------- Marcas ----------
  @Get('marcas')
  async marcas() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select m.*, (select count(*)::int from produtos p where p.marca_id = m.id) as produtos
         from marcas m order by m.nome`,
    );
    return rows;
  }

  @Post('marcas')
  async criarMarca(@Body() dto: MarcaDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into marcas (nome, logo_url, ativo) values ($1,$2,coalesce($3,true)) returning *`,
      [dto.nome, dto.logoUrl ?? null, dto.ativo],
    );
    return rows[0];
  }

  @Put('marcas/:id')
  async editarMarca(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MarcaDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `update marcas set nome=$2, logo_url=$3, ativo=coalesce($4,ativo) where id=$1 returning *`,
      [id, dto.nome, dto.logoUrl ?? null, dto.ativo],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  // ---------- Promoções ----------
  @Get('promocoes')
  async promocoes() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.*, now() between p.inicio_em and p.fim_em as vigente,
        (select json_agg(json_build_object('produtoId', pp.produto_id, 'nome', pr.nome, 'sku', pr.sku,
            'precoPromocional', pp.preco_promocional))
           from promocao_produtos pp join produtos pr on pr.id = pp.produto_id
          where pp.promocao_id = p.id) as produtos
         from promocoes p order by p.inicio_em desc`,
    );
    return rows;
  }

  @Post('promocoes')
  async criarPromocao(@Body() dto: PromocaoDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into promocoes (nome, inicio_em, fim_em, ativo) values ($1,$2,$3,coalesce($4,true)) returning id`,
        [dto.nome, dto.inicioEm, dto.fimEm, dto.ativo],
      );
      for (const p of dto.produtos) {
        await client.query(
          `insert into promocao_produtos (promocao_id, produto_id, preco_promocional) values ($1,$2,$3)`,
          [rows[0].id, p.produtoId, p.precoPromocional],
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

  @Put('promocoes/:id')
  async editarPromocao(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PromocaoDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(
        `update promocoes set nome=$2, inicio_em=$3, fim_em=$4, ativo=coalesce($5,ativo) where id=$1 returning id`,
        [id, dto.nome, dto.inicioEm, dto.fimEm, dto.ativo],
      );
      if (!r.rowCount) throw new NotFoundException();
      await client.query(`delete from promocao_produtos where promocao_id = $1`, [id]);
      for (const p of dto.produtos) {
        await client.query(
          `insert into promocao_produtos (promocao_id, produto_id, preco_promocional) values ($1,$2,$3)`,
          [id, p.produtoId, p.precoPromocional],
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

  @Delete('promocoes/:id')
  async removerPromocao(@Param('id', ParseUUIDPipe) id: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from promocao_produtos where promocao_id = $1`, [id]);
    await pool.query(`delete from promocoes where id = $1`, [id]);
    return { ok: true };
  }

  // ---------- Banners ----------
  @Get('banners')
  async banners() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select * from banners order by ordem, titulo`);
    return rows;
  }

  @Post('banners')
  async criarBanner(@Body() dto: BannerDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into banners (titulo, imagem_url, destino_tipo, destino_id, ordem, inicio_em, fim_em, ativo)
       values ($1,$2,$3,$4,coalesce($5,0),$6,$7,coalesce($8,true)) returning *`,
      [dto.titulo ?? null, dto.imagemUrl, dto.destinoTipo ?? null, dto.destinoId ?? null, dto.ordem,
       dto.inicioEm ?? null, dto.fimEm ?? null, dto.ativo],
    );
    return rows[0];
  }

  @Put('banners/:id')
  async editarBanner(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `update banners set titulo=$2, imagem_url=$3, destino_tipo=$4, destino_id=$5,
              ordem=coalesce($6,ordem), inicio_em=$7, fim_em=$8, ativo=coalesce($9,ativo)
        where id=$1 returning *`,
      [id, dto.titulo ?? null, dto.imagemUrl, dto.destinoTipo ?? null, dto.destinoId ?? null, dto.ordem,
       dto.inicioEm ?? null, dto.fimEm ?? null, dto.ativo],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  @Delete('banners/:id')
  async removerBanner(@Param('id', ParseUUIDPipe) id: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from banners where id = $1`, [id]);
    return { ok: true };
  }

  /** Busca leve de produtos para o seletor de promoções/banners. */
  @Get('produtos-busca')
  async produtosBusca(@Query('q') q = '') {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.id, p.sku, p.nome,
        (select preco from precos pr join tabelas_preco t on t.id = pr.tabela_preco_id and t.padrao
          where pr.produto_id = p.id) as preco
         from produtos p where p.ativo and (p.nome ilike $1 or p.sku ilike $1)
        order by p.nome limit 12`,
      [`%${q}%`],
    );
    return rows;
  }
}
