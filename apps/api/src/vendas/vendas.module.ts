import { Module } from '@nestjs/common';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController],
  providers: [VendasAuthService, VendedorGuard],
})
export class VendasModule {}
