import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { tenantCtx } from '../tenancy/tenant-context';

class AcessoVendedorDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Login aceita letras, números, ponto, hífen e sublinhado' })
  login!: string;

  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;

  @IsBoolean() ativo!: boolean;
}

class CondicoesDaTabelaDto {
  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true })
  condicaoIds!: string[];
}

@Controller('admin/vendas')
@UseGuards(AdminGuard)
export class AdminVendasController {
  @Get('vendedores')
  async vendedores() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select v.id, v.erp_vendedor_id, v.nome, v.filial, v.login, (v.senha_hash is not null) as tem_senha, v.ativo,
              v.ultima_sync_em, v.app_versao,
              (select count(*)::int from cliente_vendedor cv where cv.vendedor_id = v.id) as clientes
         from vendedores v order by v.nome`,
    );
    return rows.map((v) => ({
      id: v.id, erpVendedorId: v.erp_vendedor_id, nome: v.nome, filial: v.filial, login: v.login, temSenha: v.tem_senha,
      ativo: v.ativo, ultimaSyncEm: v.ultima_sync_em, appVersao: v.app_versao, clientes: v.clientes,
    }));
  }

  /** Senha ausente mantém a atual. Trocar a senha ou desativar derruba as sessões abertas do vendedor. */
  @Put('vendedores/:id/acesso')
  async definirAcesso(@Req() req: Request & { admin: AdminLogado }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcessoVendedorDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const login = dto.login.trim().toLowerCase();
    const emUso = await pool.query(`select 1 from vendedores where login = $1 and id <> $2`, [login, id]);
    if (emUso.rowCount) throw new ConflictException('Este login já está em uso por outro vendedor');
    const senhaHash = dto.senha ? await argon2.hash(dto.senha) : null;
    let rowCount: number | null;
    try {
      ({ rowCount } = await pool.query(
        `update vendedores set login = $2, senha_hash = coalesce($3, senha_hash), ativo = $4 where id = $1`,
        [id, login, senhaHash, dto.ativo],
      ));
    } catch (e) {
      // Corrida entre dois administradores: a restrição unique pegou o que a pré-checagem não viu.
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Este login já está em uso por outro vendedor');
      throw e;
    }
    if (!rowCount) throw new NotFoundException('Vendedor não encontrado');
    if (senhaHash || !dto.ativo) {
      // Apaga em vez de revogar: a renovação aceita token revogado há menos de 30 s.
      await pool.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'vendedor'`, [id]);
    }
    return { ok: true };
  }

  @Get('tabelas-condicoes')
  async tabelasCondicoes() {
    const { pool } = tenantCtx();
    const tabelas = await pool.query(
      `select t.id, t.nome,
              coalesce((select array_agg(x.condicao_pagamento_id) from tabela_preco_condicoes x where x.tabela_preco_id = t.id), '{}') as condicao_ids
         from tabelas_preco t where t.erp_tabela_id is not null order by t.nome`,
    );
    const condicoes = await pool.query(
      `select cp.id, cp.descricao, fp.descricao as forma
         from condicoes_pagamento_erp cp join formas_pagamento_erp fp on fp.id = cp.forma_pagamento_id
        order by fp.descricao, cp.descricao`,
    );
    return {
      tabelas: tabelas.rows.map((t) => ({ id: t.id, nome: t.nome, condicaoIds: t.condicao_ids })),
      condicoes: condicoes.rows.map((c) => ({ id: c.id, descricao: c.descricao, forma: c.forma })),
    };
  }

  @Put('tabelas-condicoes/:tabelaId')
  async definirCondicoes(@Req() req: Request & { admin: AdminLogado }, @Param('tabelaId', ParseUUIDPipe) tabelaId: string, @Body() dto: CondicoesDaTabelaDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from tabela_preco_condicoes where tabela_preco_id = $1`, [tabelaId]);
      if (dto.condicaoIds.length) {
        await client.query(
          `insert into tabela_preco_condicoes (tabela_preco_id, condicao_pagamento_id)
           select $1, unnest($2::uuid[])`,
          [tabelaId, dto.condicaoIds],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      // Tabela ou condição que não existe mais no cadastro.
      if ((e as { code?: string }).code === '23503') {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Tabela de preço ou condição de pagamento inexistente',
          codigo: 'REFERENCIA_INVALIDA',
        });
      }
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  }
}
