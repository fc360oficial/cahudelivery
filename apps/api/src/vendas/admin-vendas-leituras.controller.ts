import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AdminVendasConsultasService } from './admin-vendas-consultas.service';
import { AdminVendasPainelService } from './admin-vendas-painel.service';

/** Leituras da retaguarda de Vendas (somente consulta). O AdminGuard já exige a solução 'vendas' nestas rotas. */
@Controller('admin/vendas')
@UseGuards(AdminGuard)
export class AdminVendasLeiturasController {
  constructor(private readonly painelSvc: AdminVendasPainelService, private readonly consultas: AdminVendasConsultasService) {}

  @Get('painel')
  painel(@Query('periodo') periodo?: string, @Query('dias') dias?: string, @Query('vendedorId') vendedorId?: string) {
    return this.painelSvc.painel({ periodo, dias, vendedorId });
  }

  @Get('pedidos')
  pedidos(@Query('situacao') situacao?: string, @Query('vendedorId') vendedorId?: string, @Query('busca') busca?: string, @Query('pagina') pagina?: string) {
    return this.consultas.pedidos({ situacao, vendedorId, busca, pagina });
  }

  @Get('pedidos/:id')
  pedido(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.pedido(id);
  }

  @Get('orcamentos')
  orcamentos(@Query('status') status?: string, @Query('vendedorId') vendedorId?: string, @Query('pagina') pagina?: string) {
    return this.consultas.orcamentos({ status, vendedorId, pagina });
  }

  @Get('clientes')
  clientes(@Query('vendedorId') vendedorId?: string, @Query('busca') busca?: string, @Query('pagina') pagina?: string) {
    return this.consultas.clientes({ vendedorId, busca, pagina });
  }

  @Get('vendedores/:id/carteira')
  carteira(@Param('id', ParseUUIDPipe) id: string) {
    return this.consultas.carteira(id);
  }

  @Get('produtos')
  produtos(@Query('busca') busca?: string, @Query('tabelaId') tabelaId?: string, @Query('pagina') pagina?: string) {
    return this.consultas.produtos({ busca, tabelaId, pagina });
  }
}
