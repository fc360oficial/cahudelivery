import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MaxipagoAuthMiddleware } from './maxipago-auth.middleware';
import { MaxipagoController } from './maxipago.controller';
import { MaxipagoService } from './maxipago.service';

@Module({
  controllers: [MaxipagoController],
  providers: [MaxipagoService],
})
export class MaxipagoModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MaxipagoAuthMiddleware).forRoutes(MaxipagoController);
  }
}
