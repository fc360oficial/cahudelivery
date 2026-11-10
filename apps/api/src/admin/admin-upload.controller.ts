import { Controller, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard';
import { opcoesUploadImagem, responderUploadImagem } from './upload-imagem';

/**
 * Upload de imagens (banners, fotos de produto) feito pela retaguarda.
 * Grava em <cwd>/uploads e devolve a URL pública servida pela própria API.
 * A URL usa PUBLIC_URL quando definida (ex.: IP da rede local em testes de
 * celular) — sem isso, cai no host da própria requisição, que quebra se a
 * retaguarda for acessada por localhost mas o app for testado em outro
 * dispositivo. A lógica é compartilhada com o upload do painel de Vendas.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminUploadController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('arquivo', opcoesUploadImagem()))
  upload(@Req() req: Request, @Query('tipo') tipo?: string, @UploadedFile() arquivo?: Express.Multer.File) {
    return responderUploadImagem(req, tipo, arquivo);
  }
}
