import { Body, Controller, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { PASTA_PRIVADA } from '../admin/admin-entregas.controller';
import { tenantCtx } from '../tenancy/tenant-context';
import { AcompanhamentoService } from './acompanhamento.service';
import { hojeEmRecife } from './cargas.service';

const RE_DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

class ResolverDto {
  @IsString() @MinLength(3, { message: 'Escreva o que foi combinado com o cliente' }) @MaxLength(500)
  resolucao!: string;
}

type ReqAdmin = Request & { admin: AdminLogado };

/** Em rota e Entregues: acompanhamento das cargas do dia, comprovantes e ocorrências. */
@Controller('admin/entregas')
@UseGuards(AdminGuard)
export class EntregasAcompanhamentoController {
  constructor(private readonly acompanhamento: AcompanhamentoService) {}

  /** data ausente ou inválida = hoje (calendário de Recife). */
  @Get('acompanhamento')
  doDia(@Query('data') data?: string) {
    return this.acompanhamento.doDia(data && RE_DATA.test(data) ? data : hojeEmRecife());
  }

  @Post('ocorrencias/:id/resolver')
  @HttpCode(200)
  resolver(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolverDto) {
    return this.acompanhamento.resolverOcorrencia(id, dto.resolucao.trim(), req.admin.usuarioId);
  }

  /** Foto tirada pelo motorista (romaneio assinado, mercadoria, fachada, ocorrência). Só para quem está logado. */
  @Get('fotos/:nome')
  async foto(@Param('nome') nome: string, @Res() res: Response) {
    if (!(await this.acompanhamento.fotoExiste(nome))) throw new NotFoundException();
    const { tenant } = tenantCtx();
    const caminho = join(PASTA_PRIVADA, tenant.slug.toLowerCase(), 'entregas', nome);
    if (!existsSync(caminho)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(caminho);
  }
}
