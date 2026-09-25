import { Module } from '@nestjs/common';
import { PagamentosService } from './pagamentos.service';
import { ProvedoresService } from './provedores.service';

@Module({
  providers: [PagamentosService, ProvedoresService],
  exports: [PagamentosService, ProvedoresService],
})
export class PagamentosModule {}
