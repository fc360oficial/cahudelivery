import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard, ClienteLogado } from '../auth/jwt.guard';
import { tenantCtx } from '../tenancy/tenant-context';

type ReqCliente = Request & { cliente: ClienteLogado };

class PerfilDto {
  @IsOptional() @IsString() nomeFantasia?: string;
  @IsOptional() @IsString() telefone?: string;
}

class EnderecoDto {
  @IsOptional() @IsString() apelido?: string;
  @IsNotEmpty() cep!: string;
  @IsNotEmpty() logradouro!: string;
  @IsNotEmpty() numero!: string;
  @IsOptional() @IsString() complemento?: string;
  @IsNotEmpty() bairro!: string;
  @IsNotEmpty() cidade!: string;
  @Length(2, 2) uf!: string;
  @IsOptional() @IsBoolean() padrao?: boolean;
}

class DispositivoDto {
  @IsNotEmpty() fcmToken!: string;
  @IsIn(['android', 'ios']) plataforma!: 'android' | 'ios';
}

/** Perfil, endereços, dispositivos (push) e inbox de notificações do cliente. */
@Controller()
@UseGuards(JwtAuthGuard)
export class ProfileController {
  @Get('perfil')
  async perfil(@Req() req: ReqCliente) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, tipo, documento, razao_social, nome_fantasia, email, telefone, status
         from clientes where id = $1`,
      [req.cliente.clienteId],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  @Put('perfil')
  async atualizar(@Req() req: ReqCliente, @Body() dto: PerfilDto) {
    const { pool } = tenantCtx();
    await pool.query(
      `update clientes set nome_fantasia = coalesce($2, nome_fantasia), telefone = coalesce($3, telefone) where id = $1`,
      [req.cliente.clienteId, dto.nomeFantasia ?? null, dto.telefone ?? null],
    );
    return this.perfil(req);
  }

  @Get('perfil/enderecos')
  async enderecos(@Req() req: ReqCliente) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select * from cliente_enderecos where cliente_id = $1 order by padrao desc, apelido`,
      [req.cliente.clienteId],
    );
    return rows;
  }

  @Post('perfil/enderecos')
  async criarEndereco(@Req() req: ReqCliente, @Body() dto: EnderecoDto) {
    const { pool } = tenantCtx();
    if (dto.padrao) {
      await pool.query(`update cliente_enderecos set padrao = false where cliente_id = $1`, [req.cliente.clienteId]);
    }
    const { rows } = await pool.query(
      `insert into cliente_enderecos (cliente_id, apelido, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [
        req.cliente.clienteId,
        dto.apelido ?? null,
        dto.cep.replace(/\D/g, ''),
        dto.logradouro,
        dto.numero,
        dto.complemento ?? null,
        dto.bairro,
        dto.cidade,
        dto.uf.toUpperCase(),
        dto.padrao ?? false,
      ],
    );
    return rows[0];
  }

  @Put('perfil/enderecos/:id')
  async editarEndereco(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnderecoDto) {
    const { pool } = tenantCtx();
    if (dto.padrao) {
      await pool.query(`update cliente_enderecos set padrao = false where cliente_id = $1`, [req.cliente.clienteId]);
    }
    const { rows } = await pool.query(
      `update cliente_enderecos
          set apelido=$3, cep=$4, logradouro=$5, numero=$6, complemento=$7, bairro=$8, cidade=$9, uf=$10, padrao=$11
        where id = $1 and cliente_id = $2 returning *`,
      [
        id,
        req.cliente.clienteId,
        dto.apelido ?? null,
        dto.cep.replace(/\D/g, ''),
        dto.logradouro,
        dto.numero,
        dto.complemento ?? null,
        dto.bairro,
        dto.cidade,
        dto.uf.toUpperCase(),
        dto.padrao ?? false,
      ],
    );
    if (!rows[0]) throw new NotFoundException('Endereço não encontrado');
    return rows[0];
  }

  @Delete('perfil/enderecos/:id')
  async removerEndereco(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    const { pool } = tenantCtx();
    const usado = await pool.query(
      `select 1 from pedidos where cliente_id = $1 and endereco_snapshot_json->>'id' = $2 limit 1`,
      [req.cliente.clienteId, id],
    );
    if (usado.rowCount) throw new BadRequestException('Endereço já usado em pedidos — edite em vez de remover');
    await pool.query(`delete from cliente_enderecos where id = $1 and cliente_id = $2`, [id, req.cliente.clienteId]);
    return { ok: true };
  }

  @Post('dispositivos')
  async registrarDispositivo(@Req() req: ReqCliente, @Body() dto: DispositivoDto) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into dispositivos (cliente_id, fcm_token, plataforma)
       values ($1,$2,$3)
       on conflict (fcm_token) do update set cliente_id = $1, plataforma = $3, atualizado_em = now()`,
      [req.cliente.clienteId, dto.fcmToken, dto.plataforma],
    );
    return { ok: true };
  }

  @Get('notificacoes')
  async notificacoes(@Req() req: ReqCliente) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select n.id, n.titulo, n.corpo, n.enviada_em, ne.lida_em
         from notificacoes n
         join notificacao_entregas ne on ne.notificacao_id = n.id and ne.cliente_id = $1
        order by n.enviada_em desc limit 50`,
      [req.cliente.clienteId],
    );
    return rows;
  }
}
