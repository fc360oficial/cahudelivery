import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { EntregasCadastrosController } from './entregas-cadastros.controller';

/** Fluxo Entregas: retaguarda da montagem de carga e, nas próximas etapas, a API do aplicativo do motorista. */
@Module({
  controllers: [EntregasCadastrosController],
  providers: [AdminGuard],
})
export class EntregasModule {}
