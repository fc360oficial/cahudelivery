import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { CargasService, hojeEmRecife } from './cargas.service';

const RE_DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

class DataDto {
  @Matches(RE_DATA, { message: 'data deve ser AAAA-MM-DD' })
  data!: string;
}

class NovaCargaDto extends DataDto {
  @IsOptional() @IsUUID()
  caminhaoId?: string | null;
}

class DefinirCargaDto {
  @IsOptional() @IsUUID()
  caminhaoId?: string | null;

  @IsOptional() @IsUUID()
  motoristaId?: string | null;
}

class IncluirEntregaDto {
  @IsString() @Matches(/^(pedido|nota):[0-9a-fA-F-]{36}$/, { message: 'entregaId inválido' })
  entregaId!: string;
}

class OrdemDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(500) @IsUUID(undefined, { each: true })
  ids!: string[];
}

type ReqAdmin = Request & { admin: AdminLogado };

/** Montagem de carga: quem tem a solução "entregas" (o gerente do CD) sugere, ajusta e autoriza. */
@Controller('admin/entregas/cargas')
@UseGuards(AdminGuard)
export class EntregasCargasController {
  constructor(private readonly cargas: CargasService) {}

  /** data ausente ou inválida = hoje (calendário de Recife). */
  @Get()
  painel(@Query('data') data?: string) {
    return this.cargas.painel(data && RE_DATA.test(data) ? data : hojeEmRecife());
  }

  @Post('sugerir')
  @HttpCode(200)
  sugerir(@Req() req: ReqAdmin, @Body() dto: DataDto) {
    return this.cargas.sugerir(dto.data, req.admin.usuarioId);
  }

  @Post()
  criar(@Req() req: ReqAdmin, @Body() dto: NovaCargaDto) {
    return this.cargas.criar(dto.data, dto.caminhaoId ?? null, req.admin.usuarioId);
  }

  @Put(':id')
  definir(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DefinirCargaDto) {
    return this.cargas.definir(id, dto.caminhaoId ?? null, dto.motoristaId ?? null);
  }

  @Delete(':id')
  excluir(@Param('id', ParseUUIDPipe) id: string) {
    return this.cargas.excluir(id);
  }

  @Post(':id/entregas')
  @HttpCode(200)
  incluir(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IncluirEntregaDto) {
    return this.cargas.adicionar(id, dto.entregaId);
  }

  @Delete(':id/entregas/:linhaId')
  tirar(@Param('id', ParseUUIDPipe) id: string, @Param('linhaId', ParseUUIDPipe) linhaId: string) {
    return this.cargas.remover(id, linhaId);
  }

  @Put(':id/ordem')
  ordem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OrdemDto) {
    return this.cargas.reordenar(id, dto.ids);
  }

  /** Ordem da rota mais curta saindo do CD e voltando. */
  @Post(':id/otimizar')
  @HttpCode(200)
  otimizar(@Param('id', ParseUUIDPipe) id: string) {
    return this.cargas.otimizar(id);
  }

  @Post(':id/autorizar')
  @HttpCode(200)
  autorizar(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.cargas.autorizar(id, req.admin.usuarioId);
  }

  @Post(':id/reabrir')
  @HttpCode(200)
  reabrir(@Param('id', ParseUUIDPipe) id: string) {
    return this.cargas.reabrir(id);
  }

  @Get(':id/romaneio')
  romaneio(@Param('id', ParseUUIDPipe) id: string) {
    return this.cargas.romaneio(id);
  }
}
