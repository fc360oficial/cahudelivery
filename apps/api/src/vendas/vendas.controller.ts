import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PedidoVendedorDto } from './pedido-vendedor.dto';
import { VendasPedidosService } from './vendas-pedidos.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendedorGuard, VendedorLogado } from './vendedor.guard';

type ReqVendedor = Request & { vendedor: VendedorLogado };

@Controller('vendas')
@UseGuards(VendedorGuard)
export class VendasController {
  constructor(
    private readonly sync: VendasSyncService,
    private readonly pedidos: VendasPedidosService,
  ) {}

  @Get('sync')
  carga(@Req() req: ReqVendedor, @Headers('x-app-versao') appVersao?: string) {
    return this.sync.carga(req.vendedor.vendedorId, appVersao);
  }

  @Post('pedidos')
  @HttpCode(200)
  receber(@Req() req: ReqVendedor, @Body() dto: PedidoVendedorDto) {
    return this.pedidos.receber(req.vendedor.vendedorId, dto);
  }

  @Get('pedidos')
  listar(@Req() req: ReqVendedor) {
    return this.pedidos.listar(req.vendedor.vendedorId);
  }

  @Post('pedidos/:id/confirmar')
  @HttpCode(200)
  confirmar(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.confirmar(req.vendedor.vendedorId, id);
  }

  @Post('pedidos/:id/cancelar')
  @HttpCode(200)
  cancelar(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.cancelar(req.vendedor.vendedorId, id);
  }
}
