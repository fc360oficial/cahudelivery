import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { OptionalAuthGuard, ClienteLogado } from '../auth/jwt.guard';
import { CatalogService } from './catalog.service';

type ReqCliente = Request & { cliente?: ClienteLogado };

@Controller()
@UseGuards(OptionalAuthGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('config')
  config() {
    return this.catalog.config();
  }

  @Get('home')
  home(@Req() req: ReqCliente) {
    return this.catalog.home(req.cliente?.clienteId);
  }

  @Get('categorias')
  categorias() {
    return this.catalog.categorias();
  }

  @Get('produtos')
  produtos(
    @Req() req: ReqCliente,
    @Query('categoria') categoria?: string,
    @Query('marca') marca?: string,
    @Query('busca') busca?: string,
    @Query('promocao') promocao?: string,
    @Query('pagina') pagina = '1',
    @Query('limite') limite = '20',
  ) {
    return this.catalog.produtos(
      {
        categoria,
        marca,
        busca,
        promocao: promocao === 'true',
        pagina: Math.max(1, Number(pagina) || 1),
        limite: Math.min(50, Math.max(1, Number(limite) || 20)),
      },
      req.cliente?.clienteId,
    );
  }

  @Get('produtos/:id')
  produto(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.produto(id, req.cliente?.clienteId);
  }

  @Get('promocoes')
  promocoes(@Req() req: ReqCliente) {
    return this.catalog.promocoes(req.cliente?.clienteId);
  }
}
