import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { tenantCtx } from '../tenancy/tenant-context';
import { formaInterna } from './vendas-pedidos.service';

class AcessoVendedorDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Login aceita letras, números, ponto, hífen e sublinhado' })
  login!: string;

  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;

  @IsBoolean() ativo!: boolean;
}

class FormasDaTabelaDto {
  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true })
  formaIds!: string[];

  @IsOptional() @IsIn(['entrega', 'retirada']) tipoEntrega?: 'entrega' | 'retirada';
}

@Controller('admin/vendas')
@UseGuards(AdminGuard)
export class AdminVendasController {
  @Get('vendedores')
  async vendedores() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select v.id, v.erp_vendedor_id, v.nome, v.filial, v.login, (v.senha_hash is not null) as tem_senha, v.ativo, v.acesso_bloqueado,
              v.ultima_sync_em, v.app_versao,
              (select count(*)::int from cliente_vendedor cv where cv.vendedor_id = v.id) as clientes
         from vendedores v order by v.nome`,
    );
    return rows.map((v) => ({
      id: v.id, erpVendedorId: v.erp_vendedor_id, nome: v.nome, filial: v.filial, login: v.login, temSenha: v.tem_senha,
      ativo: v.ativo && !v.acesso_bloqueado, ativoNoErp: v.ativo, bloqueadoNaRetaguarda: v.acesso_bloqueado, ultimaSyncEm: v.ultima_sync_em, appVersao: v.app_versao, clientes: v.clientes,
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
        `update vendedores set login = $2, senha_hash = coalesce($3, senha_hash), acesso_bloqueado = not $4 where id = $1`,
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

  @Get('tabelas-formas')
  async tabelasFormas() {
    const { pool } = tenantCtx();
    const tabelas = await pool.query(
      `select t.id, t.nome, t.erp_tabela_id, t.tipo_entrega,
              coalesce((select array_agg(x.forma_pagamento_id) from tabela_preco_formas x where x.tabela_preco_id = t.id), '{}') as forma_ids
         from tabelas_preco t where t.erp_tabela_id is not null order by t.nome`,
    );
    const formas = await pool.query(
      `select id, descricao, erp_forma_pagamento_id from formas_pagamento_erp order by descricao`,
    );
    return {
      tabelas: tabelas.rows.map((t) => ({ id: t.id, nome: t.nome, codigo: t.erp_tabela_id, formaIds: t.forma_ids, tipoEntrega: t.tipo_entrega })),
      formas: formas.rows.map((f) => ({
        id: f.id, descricao: f.descricao, codigo: f.erp_forma_pagamento_id, exigeCredito: formaInterna(f.descricao) === 'boleto',
      })),
    };
  }

  @Put('tabelas-formas/:tabelaId')
  async definirFormas(@Req() req: Request & { admin: AdminLogado }, @Param('tabelaId', ParseUUIDPipe) tabelaId: string, @Body() dto: FormasDaTabelaDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (dto.tipoEntrega) {
        await client.query(`update tabelas_preco set tipo_entrega = $1 where id = $2`, [dto.tipoEntrega, tabelaId]);
      }
      await client.query(`delete from tabela_preco_formas where tabela_preco_id = $1`, [tabelaId]);
      if (dto.formaIds.length) {
        await client.query(
          `insert into tabela_preco_formas (tabela_preco_id, forma_pagamento_id)
           select $1, unnest($2::uuid[])`,
          [tabelaId, dto.formaIds],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      // Tabela ou forma que não existe mais no cadastro.
      if ((e as { code?: string }).code === '23503') {
        throw new BadRequestException({
          statusCode: 400,
          message: 'Tabela de preço ou forma de pagamento inexistente',
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
