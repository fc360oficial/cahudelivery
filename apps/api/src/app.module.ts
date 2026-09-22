import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './database/database.module';
import { DlinksModule } from './integracoes-dlinks/dlinks.module';
import { GeoModule } from './geo/geo.module';
import { IntegrationModule } from './integration/integration.module';
import { MaxipagoModule } from './integracoes-maxipago/maxipago.module';
import { OrdersModule } from './orders/orders.module';
import { ProfileModule } from './profile/profile.module';
import { TenancyMiddleware } from './tenancy/tenant-context';

@Module({
  imports: [DatabaseModule, IntegrationModule, AuthModule, CatalogModule, OrdersModule, ProfileModule, AdminModule, DlinksModule, GeoModule, MaxipagoModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Rotas do Dlinks resolvem o tenant pela apikey (DlinksAuthMiddleware),
    // nunca pelo header X-Tenant — excluir aqui torna isso estrutural.
    // O webhook da MaxiPago resolve o tenant pelo segredo no caminho da URL
    // (MaxipagoAuthMiddleware) — o gateway não conhece nosso header X-Tenant.
    consumer
      .apply(TenancyMiddleware)
      .exclude('integracoes/dlinks/(.*)', 'integracoes/maxipago/(.*)')
      .forRoutes('*');
  }
}
