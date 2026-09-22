import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { assinaturaConfere, TipoArquivo } from './assinatura';
import { NotasService } from './notas.service';

@Controller('notas/:tenant/:pedidoId')
export class NotasController {
  constructor(private readonly notas: NotasService) {}

  /** 404 (e não 403) para assinatura errada: não confirma se o pedido existe. */
  private conferir(tenant: string, pedidoId: string, tipo: TipoArquivo, t: string | undefined) {
    if (!assinaturaConfere(tenant.toLowerCase(), pedidoId, tipo, t)) throw new NotFoundException();
  }

  @Get('nota.xml')
  async xml(
    @Param('tenant') tenant: string,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Query('t') t: string | undefined,
    @Res() res: Response,
  ) {
    this.conferir(tenant, pedidoId, 'xml', t);
    const nota = await this.notas.xml(pedidoId);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="NFe${nota.chave}.xml"`);
    res.send(nota.xml);
  }

  @Get('danfe.pdf')
  async danfe(
    @Param('tenant') tenant: string,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Query('t') t: string | undefined,
    @Res() res: Response,
  ) {
    this.conferir(tenant, pedidoId, 'pdf', t);
    const { pdf, numero } = await this.notas.danfe(pedidoId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DANFE-${numero}.pdf"`);
    res.send(pdf);
  }
}
