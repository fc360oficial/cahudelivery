import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { CargasService } from './cargas.service';
import { EntregasCadastrosController } from './entregas-cadastros.controller';
import { EntregasCargasController } from './entregas-cargas.controller';
import { EntregasNotasController } from './entregas-notas.controller';
import { EntregasPesosController } from './entregas-pesos.controller';
import { MotoristaAuthController, MotoristaAuthService, MotoristaGuard } from './motorista-auth';
import { MotoristaController } from './motorista.controller';
import { MotoristaService } from './motorista.service';
import { NotasAEntregarService } from './notas-a-entregar.service';
import { PesosProdutosService } from './pesos-produtos.service';

/** Fluxo Entregas: retaguarda da montagem de carga (/admin/entregas) e a API do aplicativo do motorista (/motorista). */
@Module({
  controllers: [
    EntregasCadastrosController, EntregasNotasController, EntregasPesosController, EntregasCargasController,
    MotoristaAuthController, MotoristaController,
  ],
  providers: [AdminGuard, NotasAEntregarService, PesosProdutosService, CargasService, MotoristaAuthService, MotoristaGuard, MotoristaService],
})
export class EntregasModule {}
