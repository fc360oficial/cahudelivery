import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OutboxWorker } from './outbox.worker';

@Module({
  imports: [CatalogModule],
  controllers: [OrdersController],
  providers: [OrdersService, OutboxWorker],
})
export class OrdersModule {}
