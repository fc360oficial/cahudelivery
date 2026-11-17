import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { CargasService } from './cargas.service';
import { EntregasCadastrosController } from './entregas-cadastros.controller';
import { EntregasCargasController } from './entregas-cargas.controller';
import { EntregasNotasController } from './entregas-notas.controller';
import { EntregasPesosController } from './entregas-pesos.controller';
import { NotasAEntregarService } from './notas-a-entregar.service';
import { PesosProdutosService } from './pesos-produtos.service';

/** Fluxo Entregas: retaguarda da montagem de carga e, nas próximas etapas, a API do aplicativo do motorista. */
@Module({
  controllers: [EntregasCadastrosController, EntregasNotasController, EntregasPesosController, EntregasCargasController],
  providers: [AdminGuard, NotasAEntregarService, PesosProdutosService, CargasService],
})
export class EntregasModule {}
