import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, AdminLogado } from './admin.guard';
import { AdminService } from './admin.service';

type ReqAdmin = Request & { admin: AdminLogado };

class StatusClienteDto {
  @IsIn(['aprovado', 'bloqueado', 'pendente']) status!: 'aprovado' | 'bloqueado' | 'pendente';
}

class AtivoDto {
  @IsBoolean() ativo!: boolean;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('pedidos')
  pedidos(@Query('status') status?: string, @Query('busca') busca?: string, @Query('pagina') pagina = '1') {
    return this.admin.pedidos({ status, busca, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Get('pedidos/:id')
  pedido(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.pedido(id);
  }

  @Post('pedidos/:id/reenviar-erp')
  reenviar(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reenviarErp(id, req.admin.usuarioId);
  }

  @Get('clientes')
  clientes(@Query('status') status?: string, @Query('busca') busca?: string, @Query('pagina') pagina = '1') {
    return this.admin.clientes({ status, busca, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Patch('clientes/:id/status')
  statusCliente(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusClienteDto) {
    return this.admin.mudarStatusCliente(id, dto.status, req.admin.usuarioId);
  }

  @Delete('clientes/:id')
  excluirCliente(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.excluirCliente(id, req.admin.usuarioId);
  }

  @Get('produtos')
  produtos(@Query('busca') busca?: string, @Query('pagina') pagina = '1') {
    return this.admin.produtos({ busca, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Patch('produtos/:id/ativo')
  alternarProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtivoDto) {
    return this.admin.alternarProduto(id, dto.ativo, req.admin.usuarioId);
  }

  @Get('logs/integracao')
  logs(@Query('pagina') pagina = '1') {
    return this.admin.logsIntegracao(Math.max(1, Number(pagina) || 1));
  }
}
