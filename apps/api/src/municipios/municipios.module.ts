import { Module } from '@nestjs/common';
import { MunicipiosWorker } from './municipios.worker';

@Module({
  providers: [MunicipiosWorker],
  exports: [MunicipiosWorker],
})
export class MunicipiosModule {}
