import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, AdminLogado } from './admin.guard';
import { AdminService } from './admin.service';
import { MapaService } from './mapa.service';
import { parseFiltrosMapa } from './mapa-filtros';
import { MunicipiosWorker } from '../municipios/municipios.worker';
import { tenantCtx } from '../tenancy/tenant-context';

type ReqAdmin = Request & { admin: AdminLogado };

class StatusClienteDto {
  @IsIn(['aprovado', 'bloqueado', 'pendente']) status!: 'aprovado' | 'bloqueado' | 'pendente';
}

class AtivoDto {
  @IsBoolean() ativo!: boolean;
}

class TabelaClienteDto {
  /** null/ausente = volta para a tabela padrão do tenant */
  @IsOptional() @IsUUID() tabelaPrecoId?: string | null;
}

class DescontoQtdDto {
  @IsOptional() @IsInt() @Min(1) descontoQtdMinima?: number;
  @IsOptional() @IsNumber() @Min(0) descontoQtdPreco?: number;
}

class ValidadeDto {
  @IsOptional() @IsDateString() dataValidade?: string;
}

class ImagemProdutoDto {
  @IsNotEmpty() @IsString() url!: string;
  @IsOptional() @IsString() urlMiniatura?: string;
}

class MovimentoCarteiraDto {
  @IsNumber() valor!: number;
  @IsString() motivo!: string;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly mapa: MapaService,
    private readonly municipios: MunicipiosWorker,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('pedidos')
  pedidos(@Query('status') status?: string, @Query('busca') busca?: string, @Query('pagina') pagina = '1') {
    return this.admin.pedidos({ status, busca, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Get('pedidos/:id')
  pedido(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.pedido(id);
  }

  @Get('mapa')
  mapaDados(@Query('de') de?: string, @Query('ate') ate?: string, @Query('status') status?: string) {
    return this.mapa.mapa(parseFiltrosMapa({ de, ate, status }));
  }

  @Post('mapa/geocodificar')
  @HttpCode(200)
  mapaGeocodificar(@Query('refazer') refazer?: string) {
    return this.mapa.geocodificarAgora(refazer === '1');
  }

  /** Dispara agora o worker de municípios (que normalmente só roda às 04:00) só para este tenant. */
  @Post('clientes/municipios/resolver')
  @HttpCode(200)
  resolverMunicipios() {
    return this.municipios.dispararAgora(tenantCtx().tenant.slug);
  }

  @Get('clientes/municipios/estado')
  estadoMunicipios() {
    return this.municipios.estado();
  }

  @Post('pedidos/:id/reenviar-erp')
  reenviar(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reenviarErp(id, req.admin.usuarioId);
  }

  @Get('clientes')
  clientes(@Query('status') status?: string, @Query('busca') busca?: string, @Query('pagina') pagina = '1') {
    return this.admin.clientes({ status, busca, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Get('clientes/:id/ficha')
  fichaCliente(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.fichaCliente(id);
  }

  @Patch('clientes/:id/status')
  statusCliente(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusClienteDto) {
    return this.admin.mudarStatusCliente(id, dto.status, req.admin.usuarioId);
  }

  @Get('tabelas-preco')
  tabelasPreco() {
    return this.admin.tabelasPreco();
  }

  @Patch('clientes/:id/tabela-preco')
  tabelaCliente(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TabelaClienteDto) {
    return this.admin.definirTabelaCliente(id, dto.tabelaPrecoId ?? null, req.admin.usuarioId);
  }

  @Delete('clientes/:id')
  excluirCliente(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.excluirCliente(id, req.admin.usuarioId);
  }

  @Post('clientes/:id/redefinir-senha')
  @HttpCode(200)
  redefinirSenha(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    return this.admin.redefinirSenhaCliente(id, req.admin.usuarioId);
  }

  @Get('produtos')
  produtos(@Query('busca') busca?: string, @Query('estoque') estoque?: string, @Query('imagem') imagem?: string, @Query('pagina') pagina = '1') {
    const filtroEstoque = estoque === 'com' || estoque === 'sem' ? estoque : undefined;
    const filtroImagem = imagem === 'com' || imagem === 'sem' ? imagem : undefined;
    return this.admin.produtos({ busca, estoque: filtroEstoque, imagem: filtroImagem, pagina: Math.max(1, Number(pagina) || 1) });
  }

  @Patch('produtos/:id/ativo')
  alternarProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtivoDto) {
    return this.admin.alternarProduto(id, dto.ativo, req.admin.usuarioId);
  }

  @Patch('produtos/:id/desconto-qtd')
  descontoQtd(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DescontoQtdDto) {
    return this.admin.descontoQtdProduto(id, dto.descontoQtdMinima ?? null, dto.descontoQtdPreco ?? null, req.admin.usuarioId);
  }

  @Patch('produtos/:id/validade')
  validade(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ValidadeDto) {
    return this.admin.validadeProduto(id, dto.dataValidade ?? null, req.admin.usuarioId);
  }

  @Put('produtos/:id/imagem')
  definirImagemProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImagemProdutoDto) {
    return this.admin.definirImagemProduto(id, dto.url, req.admin.usuarioId, dto.urlMiniatura);
  }

  @Delete('produtos/:id/imagem')
  removerImagemProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removerImagemProduto(id, req.admin.usuarioId);
  }

  @Get('logs/integracao')
  logs(@Query('pagina') pagina = '1') {
    return this.admin.logsIntegracao(Math.max(1, Number(pagina) || 1));
  }

  @Get('credito-solicitacoes')
  filaCredito(@Query('pagina') pagina = '1') {
    return this.admin.filaCredito(Math.max(1, Number(pagina) || 1));
  }

  @Patch('credito-solicitacoes/:id/atender')
  atenderCredito(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.atenderCredito(id, req.admin.usuarioId);
  }

  @Get('clientes/:id/carteira')
  carteiraDoCliente(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.carteiraDoCliente(id);
  }

  @Post('clientes/:id/carteira')
  lancarMovimento(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MovimentoCarteiraDto) {
    return this.admin.lancarMovimentoCarteira(id, dto.valor, dto.motivo, req.admin.usuarioId);
  }

  @Get('indicacoes')
  indicacoes(@Query('pagina') pagina = '1') {
    return this.admin.indicacoes(Math.max(1, Number(pagina) || 1));
  }
}
