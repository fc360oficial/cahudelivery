import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { definirImagemProduto, ImagemProdutoDto, removerImagemProduto } from '../admin/imagem-produto';
import { opcoesUploadImagem, responderUploadImagem } from '../admin/upload-imagem';
import { tenantCtx } from '../tenancy/tenant-context';

type ReqAdmin = Request & { admin: AdminLogado };

/**
 * Fotos de produto pelo painel de Vendas. A foto é do produto (catálogo compartilhado com o Delivery):
 * mesma linha em produto_imagens e mesmo arquivo em /uploads. Lógica compartilhada com as rotas de Delivery.
 */
@Controller('admin/vendas')
@UseGuards(AdminGuard)
export class AdminVendasImagensController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('arquivo', opcoesUploadImagem()))
  upload(@Req() req: Request, @Query('tipo') tipo?: string, @UploadedFile() arquivo?: Express.Multer.File) {
    return responderUploadImagem(req, tipo, arquivo);
  }

  @Put('produtos/:id/imagem')
  definir(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImagemProdutoDto) {
    return definirImagemProduto(tenantCtx().pool, id, dto.url, req.admin.usuarioId, dto.urlMiniatura);
  }

  @Delete('produtos/:id/imagem')
  remover(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return removerImagemProduto(tenantCtx().pool, id, req.admin.usuarioId);
  }
}
