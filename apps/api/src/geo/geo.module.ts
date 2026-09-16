import { Module } from '@nestjs/common';
import { GeocodificacaoWorker } from './geocodificacao.worker';

@Module({
  providers: [GeocodificacaoWorker],
  exports: [GeocodificacaoWorker],
})
export class GeoModule {}
