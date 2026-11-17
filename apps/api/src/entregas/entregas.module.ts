import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { EntregasCadastrosController } from './entregas-cadastros.controller';
import { EntregasNotasController } from './entregas-notas.controller';
import { NotasAEntregarService } from './notas-a-entregar.service';

/** Fluxo Entregas: retaguarda da montagem de carga e, nas próximas etapas, a API do aplicativo do motorista. */
@Module({
  controllers: [EntregasCadastrosController, EntregasNotasController],
  providers: [AdminGuard, NotasAEntregarService],
})
export class EntregasModule {}
