import { Controller, Get, Query } from '@nestjs/common';
import { DlinksPedidosService } from './dlinks-pedidos.service';

@Controller('integracoes/dlinks')
export class DlinksPedidosController {
  constructor(private readonly service: DlinksPedidosService) {}

  @Get('pedidos')
  listar(@Query('data_inicial') dataInicial: string, @Query('data_final') dataFinal: string) {
    return this.service.listar(dataInicial, dataFinal);
  }
}
