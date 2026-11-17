import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
