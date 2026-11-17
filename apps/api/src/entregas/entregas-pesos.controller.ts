import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { PesosProdutosService, SITUACOES_PESO, type SituacaoPeso } from './pesos-produtos.service';

class PesoProdutoDto {
  /** Peso da caixa/fardo em kg. Nulo ou ausente apaga o peso informado. */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 }) @Min(0.001) @Max(5000)
  pesoKg?: number | null;
}

@Controller('admin/entregas')
@UseGuards(AdminGuard)
export class EntregasPesosController {
  constructor(private readonly pesos: PesosProdutosService) {}

  /** situacao: sem (padrão) | estimado | cadastro. Qualquer outro valor cai no padrão. */
  @Get('pesos')
  listar(@Query('situacao') situacao?: string, @Query('busca') busca?: string) {
    const valida = (SITUACOES_PESO as readonly string[]).includes(situacao ?? '') ? (situacao as SituacaoPeso) : 'sem';
    return this.pesos.listar(valida, busca?.slice(0, 80));
  }

  @Put('produtos/:id/peso')
  definir(@Req() req: Request & { admin: AdminLogado }, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PesoProdutoDto) {
    return this.pesos.definir(id, dto.pesoKg ?? null, req.admin.usuarioId);
  }
}
