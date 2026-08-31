import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DlinksAuthMiddleware } from './dlinks-auth.middleware';
import { DlinksPedidosController } from './dlinks-pedidos.controller';
import { DlinksPedidosService } from './dlinks-pedidos.service';

@Module({
  controllers: [DlinksPedidosController],
  providers: [DlinksPedidosService],
})
export class DlinksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DlinksAuthMiddleware).forRoutes(DlinksPedidosController);
  }
}
