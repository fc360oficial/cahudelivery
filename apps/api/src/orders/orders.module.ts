import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { PagamentosModule } from '../pagamentos/pagamentos.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OutboxWorker } from './outbox.worker';

@Module({
  imports: [CatalogModule, PagamentosModule],
  controllers: [OrdersController],
  providers: [OrdersService, OutboxWorker],
})
export class OrdersModule {}
