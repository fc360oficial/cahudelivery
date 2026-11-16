import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DlinksAuthMiddleware } from './dlinks-auth.middleware';
import { DlinksEntregasController } from './dlinks-entregas.controller';
import { DlinksEntregasService } from './dlinks-entregas.service';
import { DlinksPedidosController } from './dlinks-pedidos.controller';
import { DlinksPedidosService } from './dlinks-pedidos.service';
import { DlinksSyncController } from './dlinks-sync.controller';
import { DlinksSyncService } from './dlinks-sync.service';
import { DlinksVendedoresController } from './dlinks-vendedores.controller';
import { DlinksVendedoresService } from './dlinks-vendedores.service';

@Module({
  controllers: [DlinksPedidosController, DlinksSyncController, DlinksVendedoresController, DlinksEntregasController],
  providers: [DlinksPedidosService, DlinksSyncService, DlinksVendedoresService, DlinksEntregasService],
})
export class DlinksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(DlinksAuthMiddleware)
      .forRoutes(DlinksPedidosController, DlinksSyncController, DlinksVendedoresController, DlinksEntregasController);
  }
}
