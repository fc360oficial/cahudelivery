import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { VendasSyncService } from './vendas-sync.service';
import { VendedorGuard, VendedorLogado } from './vendedor.guard';

type ReqVendedor = Request & { vendedor: VendedorLogado };

@Controller('vendas')
@UseGuards(VendedorGuard)
export class VendasController {
  constructor(private readonly sync: VendasSyncService) {}

  @Get('sync')
  carga(@Req() req: ReqVendedor, @Headers('x-app-versao') appVersao?: string) {
    return this.sync.carga(req.vendedor.vendedorId, appVersao);
  }
}
