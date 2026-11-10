import { Module } from '@nestjs/common';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendasOrcamentosService } from './vendas-orcamentos.service';
import { VendasPedidosService } from './vendas-pedidos.service';
import { VendasResumoService } from './vendas-resumo.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendasController } from './vendas.controller';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController, VendasController],
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService, VendasOrcamentosService, VendasResumoService],
})
export class VendasModule {}
