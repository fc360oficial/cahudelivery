import { Global, Module } from '@nestjs/common';
import { IntegrationService } from './integration.service';

@Global()
@Module({
  providers: [IntegrationService],
  exports: [IntegrationService],
})
export class IntegrationModule {}
