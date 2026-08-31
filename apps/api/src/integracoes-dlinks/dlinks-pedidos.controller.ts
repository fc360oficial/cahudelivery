import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CodigosDto } from './codigos.dto';
import { DlinksPedidosService } from './dlinks-pedidos.service';

@Controller('integracoes/dlinks')
export class DlinksPedidosController {
  constructor(private readonly service: DlinksPedidosService) {}

  @Get('pedidos')
  listar(@Query('data_inicial') dataInicial: string, @Query('data_final') dataFinal: string) {
    return this.service.listar(dataInicial, dataFinal);
  }

  @Post('pedidos/recebido')
  recebido(@Body() dto: CodigosDto) {
    return this.service.marcarRecebido(dto.codigos);
  }

  @Post('pedidos/cancelado')
  cancelado(@Body() dto: CodigosDto) {
    return this.service.marcarCancelado(dto.codigos);
  }
}
