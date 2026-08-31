import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CodigosDto } from './codigos.dto';
import { DlinksPedidosService } from './dlinks-pedidos.service';
import { ListarPedidosDto } from './listar-pedidos.dto';

@Controller('integracoes/dlinks')
export class DlinksPedidosController {
  constructor(private readonly service: DlinksPedidosService) {}

  @Get('pedidos')
  listar(@Query() query: ListarPedidosDto) {
    return this.service.listar(query.data_inicial, query.data_final);
  }

  @Post('pedidos/recebido')
  @HttpCode(200)
  recebido(@Body() dto: CodigosDto) {
    return this.service.marcarRecebido(dto.codigos);
  }

  @Post('pedidos/cancelado')
  @HttpCode(200)
  cancelado(@Body() dto: CodigosDto) {
    return this.service.marcarCancelado(dto.codigos);
  }
}
