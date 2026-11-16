import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DlinksEntregasService } from './dlinks-entregas.service';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { NotaEntregaDto } from './nota-entrega.dto';

@Controller('integracoes/dlinks')
export class DlinksEntregasController {
  constructor(private readonly service: DlinksEntregasService) {}

  /** Fluxo Entregas: notas faturadas de pedidos digitados direto no ERP (televendas). */
  @Post('notas-entrega')
  @HttpCode(200)
  notasEntrega(@Body(new ListaOuItemPipe(NotaEntregaDto)) itens: NotaEntregaDto[]) {
    return this.service.syncNotasEntrega(itens);
  }
}
