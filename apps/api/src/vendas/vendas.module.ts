import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AdminVendasConsultasService } from './admin-vendas-consultas.service';
import { AdminVendasLeiturasController } from './admin-vendas-leituras.controller';
import { AdminVendasPainelService } from './admin-vendas-painel.service';
import { AdminVendasController } from './admin-vendas.controller';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendasOrcamentosService } from './vendas-orcamentos.service';
import { VendasPedidosService } from './vendas-pedidos.service';
import { VendasResumoService } from './vendas-resumo.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendasController } from './vendas.controller';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController, VendasController, AdminVendasController, AdminVendasLeiturasController],
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService, VendasOrcamentosService, VendasResumoService, AdminVendasPainelService, AdminVendasConsultasService, AdminGuard],
})
export class VendasModule {}
