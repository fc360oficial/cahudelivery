import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PagamentosService } from './pagamentos.service';
import { ProvedoresService } from './provedores.service';
import { WebhookAuthMiddleware } from './webhook-auth.middleware';
import { WebhookController } from './webhook.controller';
import { WebhooksProcessor } from './webhooks.processor';

@Module({
  controllers: [WebhookController],
  providers: [PagamentosService, ProvedoresService, WebhooksProcessor],
  exports: [PagamentosService, ProvedoresService, WebhooksProcessor],
})
export class PagamentosModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(WebhookAuthMiddleware).forRoutes(WebhookController);
  }
}
