import { Module } from '@nestjs/common';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendasController } from './vendas.controller';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController, VendasController],
  providers: [VendasAuthService, VendedorGuard, VendasSyncService],
})
export class VendasModule {}
