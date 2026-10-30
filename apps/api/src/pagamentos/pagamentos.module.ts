import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PagamentosService } from './pagamentos.service';
import { PagamentosWorker } from './pagamentos.worker';
import { ProvedoresService } from './provedores.service';
import { TresDsController } from './tres-ds.controller';
import { WebhookAuthMiddleware } from './webhook-auth.middleware';
import { WebhookController } from './webhook.controller';
import { WebhooksProcessor } from './webhooks.processor';

@Module({
  controllers: [WebhookController, TresDsController],
  providers: [PagamentosService, ProvedoresService, WebhooksProcessor, PagamentosWorker],
  exports: [PagamentosService, ProvedoresService, WebhooksProcessor],
})
export class PagamentosModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(WebhookAuthMiddleware).forRoutes(WebhookController);
  }
}
