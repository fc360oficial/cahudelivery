import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DlinksAuthMiddleware } from './dlinks-auth.middleware';
import { DlinksPedidosController } from './dlinks-pedidos.controller';
import { DlinksPedidosService } from './dlinks-pedidos.service';
import { DlinksSyncController } from './dlinks-sync.controller';
import { DlinksSyncService } from './dlinks-sync.service';

@Module({
  controllers: [DlinksPedidosController, DlinksSyncController],
  providers: [DlinksPedidosService, DlinksSyncService],
})
export class DlinksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DlinksAuthMiddleware).forRoutes(DlinksPedidosController, DlinksSyncController);
  }
}
