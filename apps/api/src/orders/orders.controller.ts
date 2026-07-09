import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard, ClienteLogado } from '../auth/jwt.guard';
import { OrdersService } from './orders.service';

type ReqCliente = Request & { cliente: ClienteLogado };

class ItemDto {
  @IsUUID() produtoId!: string;
  @Min(0) quantidade!: number;
}

class CriarPedidoDto {
  @IsUUID() enderecoId!: string;
  @IsIn(['boleto', 'pix']) formaPagamento!: 'boleto' | 'pix';
  @IsOptional() @IsString() observacoes?: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('carrinho')
  carrinho(@Req() req: ReqCliente) {
    return this.orders.carrinho(req.cliente.clienteId);
  }

  @Put('carrinho/itens')
  upsertItem(@Req() req: ReqCliente, @Body() dto: ItemDto) {
    return this.orders.upsertItem(req.cliente.clienteId, dto.produtoId, dto.quantidade);
  }

  @Delete('carrinho/itens/:produtoId')
  remover(@Req() req: ReqCliente, @Param('produtoId', ParseUUIDPipe) produtoId: string) {
    return this.orders.removerItem(req.cliente.clienteId, produtoId);
  }

  @Post('pedidos')
  criar(@Req() req: ReqCliente, @Body() dto: CriarPedidoDto) {
    return this.orders.criarPedido(req.cliente.clienteId, dto);
  }

  @Get('pedidos')
  listar(@Req() req: ReqCliente, @Query('pagina') pagina = '1') {
    return this.orders.listar(req.cliente.clienteId, Math.max(1, Number(pagina) || 1));
  }

  @Get('pedidos/:id')
  detalhe(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detalhe(req.cliente.clienteId, id);
  }

  @Post('pedidos/:id/repetir')
  repetir(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.repetir(req.cliente.clienteId, id);
  }
}
