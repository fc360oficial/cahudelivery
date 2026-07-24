import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, MinLength } from 'class-validator';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard, AdminLogado } from './admin.guard';

type ReqAdmin = Request & { admin: AdminLogado };

class NotificacaoDto {
  @IsNotEmpty() titulo!: string;
  @IsNotEmpty() corpo!: string;
  @IsIn(['todos']) destino!: 'todos'; // segmentos entram com o FCM
}

class UsuarioDto {
  @IsNotEmpty() nome!: string;
  @IsEmail() email!: string;
  @IsOptional() @MinLength(8) senha?: string;
  @IsIn(['admin', 'operador']) papel!: 'admin' | 'operador';
  @IsOptional() @IsBoolean() ativo?: boolean;
}

class ConfiguracoesDto {
  @IsObject() valores!: Record<string, unknown>;
}

const CHAVES_PERMITIDAS = ['pedido_minimo', 'formas_pagamento', 'aprovacao_cadastro', 'horario_atendimento', 'limite_estoque_baixo', 'dias_vencimento_proximo'];

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminConfigController {
  // ---------- Notificações ----------
  @Get('notificacoes')
  async notificacoes() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select n.*, (select count(*)::int from notificacao_entregas e where e.notificacao_id = n.id) as entregues,
              (select count(*)::int from notificacao_entregas e where e.notificacao_id = n.id and e.lida_em is not null) as lidas
         from notificacoes n order by n.enviada_em desc nulls last limit 50`,
    );
    return rows;
  }

  /** Cria e "envia": grava a inbox de todos os clientes aprovados. Push FCM entra quando o projeto Firebase existir. */
  @Post('notificacoes')
  async enviar(@Req() req: ReqAdmin, @Body() dto: NotificacaoDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into notificacoes (titulo, corpo, destino, enviada_em) values ($1,$2,$3,now()) returning id`,
      [dto.titulo, dto.corpo, dto.destino],
    );
    const ent = await pool.query(
      `insert into notificacao_entregas (notificacao_id, cliente_id)
       select $1, id from clientes where status = 'aprovado'
       returning cliente_id`,
      [rows[0].id],
    );
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id) values ($1,'enviar','notificacao',$2)`,
      [req.admin.usuarioId, rows[0].id],
    );
    return { id: rows[0].id, entregues: ent.rowCount };
  }

  // ---------- Usuários da retaguarda ----------
  @Get('usuarios')
  async usuarios() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select id, nome, email, papel, ativo, criado_em from usuarios_admin order by nome`);
    return rows;
  }

  @Post('usuarios')
  async criarUsuario(@Req() req: ReqAdmin, @Body() dto: UsuarioDto) {
    this.exigirAdmin(req);
    if (!dto.senha) throw new ForbiddenException('Senha obrigatória para novo usuário');
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into usuarios_admin (nome, email, senha_hash, papel) values ($1,$2,$3,$4) returning id, nome, email, papel, ativo`,
      [dto.nome, dto.email.toLowerCase(), await argon2.hash(dto.senha), dto.papel],
    );
    return rows[0];
  }

  @Put('usuarios/:id')
  async editarUsuario(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UsuarioDto) {
    this.exigirAdmin(req);
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `update usuarios_admin set nome=$2, email=$3, papel=$4, ativo=coalesce($5,ativo) where id=$1
       returning id, nome, email, papel, ativo`,
      [id, dto.nome, dto.email.toLowerCase(), dto.papel, dto.ativo],
    );
    if (!rows[0]) throw new NotFoundException();
    if (dto.senha) {
      await pool.query(`update usuarios_admin set senha_hash=$2 where id=$1`, [id, await argon2.hash(dto.senha)]);
    }
    return rows[0];
  }

  // ---------- Configurações ----------
  @Get('configuracoes')
  async configuracoes() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select chave, valor_json from configuracoes`);
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor_json]));
  }

  @Patch('configuracoes')
  async salvarConfiguracoes(@Req() req: ReqAdmin, @Body() dto: ConfiguracoesDto) {
    this.exigirAdmin(req);
    const { pool } = tenantCtx();
    for (const [chave, valor] of Object.entries(dto.valores)) {
      if (!CHAVES_PERMITIDAS.includes(chave)) continue;
      await pool.query(
        `insert into configuracoes (chave, valor_json) values ($1,$2)
         on conflict (chave) do update set valor_json = excluded.valor_json`,
        [chave, JSON.stringify(valor)],
      );
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, dados_json) values ($1,'salvar','configuracoes',$2)`,
      [req.admin.usuarioId, JSON.stringify(dto.valores)],
    );
    return this.configuracoes();
  }

  private exigirAdmin(req: ReqAdmin) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
  }
}
