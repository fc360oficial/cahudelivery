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
import { CategoriaDto, criarCategoria, editarCategoria, listarCategorias } from './categorias';

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

/** CRUD do catálogo gerenciado pela retaguarda (categorias, marcas, promoções, banners). */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminCatalogoController {
  // ---------- Categorias ----------
  @Get('categorias')
  async categorias() {
    return listarCategorias();
  }

  @Post('categorias')
  async criarCategoria(@Body() dto: CategoriaDto) {
    return criarCategoria(dto);
  }

  @Put('categorias/:id')
  async editarCategoria(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CategoriaDto) {
    return editarCategoria(id, dto);
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
  /**
   * Produtos que PODEM entrar numa promoção: ativos, com estoque no CD e com foto
   * (o app esconde item sem estoque e o card sem foto fica feio). Lista inteira,
   * ~170 itens, pra tela de Ofertas selecionar por clique em vez de digitar.
   */
  @Get('promocoes-produtos')
  async promocoesProdutos() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.id, p.sku, p.nome, p.unidade_venda, p.qtd_por_embalagem,
              c.id as categoria_id, c.nome as categoria,
              coalesce(e.quantidade, 0) as estoque,
              (select pr.preco from precos pr join tabelas_preco t on t.id = pr.tabela_preco_id and t.padrao
                where pr.produto_id = p.id limit 1) as preco,
              (select coalesce(pi.url_miniatura, pi.url) from produto_imagens pi
                where pi.produto_id = p.id order by pi.ordem limit 1) as imagem
         from produtos p
         left join categorias c on c.id = p.categoria_id
         left join estoques e on e.produto_id = p.id
        where p.ativo and coalesce(e.quantidade, 0) > 0
          and exists (select 1 from produto_imagens pi where pi.produto_id = p.id)
        order by c.nome nulls last, p.nome`,
    );
    return rows;
  }

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
