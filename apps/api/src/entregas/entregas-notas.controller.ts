import { BadRequestException, Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { NotasAEntregarService } from './notas-a-entregar.service';

@Controller('admin/entregas')
@UseGuards(AdminGuard)
export class EntregasNotasController {
  constructor(private readonly notas: NotasAEntregarService) {}

  /** Tudo que está faturado e ainda não foi entregue, com volumes e peso estimado. */
  @Get('notas-a-entregar')
  notasAEntregar() {
    return this.notas.listar();
  }

  /** Pedido ou nota com os produtos e a carga em que está (id = pedido:<uuid> ou nota:<uuid>). */
  @Get('entregas/:id')
  detalhe(@Param('id') id: string) {
    if (!/^(pedido|nota):[0-9a-fA-F-]{36}$/.test(id)) throw new BadRequestException('Entrega inválida');
    return this.notas.detalhe(id);
  }
}
