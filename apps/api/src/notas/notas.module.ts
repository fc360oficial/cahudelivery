import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NotasController } from './notas.controller';
import { NotasService } from './notas.service';
import { NotasTenantMiddleware } from './notas-tenant.middleware';

@Module({
  controllers: [NotasController],
  providers: [NotasService],
})
export class NotasModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NotasTenantMiddleware).forRoutes(NotasController);
  }
}
