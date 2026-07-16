import { BadRequestException, Controller, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { AdminGuard } from './admin.guard';

const EXTENSOES = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/**
 * Upload de imagens (banners, fotos de produto) feito pela retaguarda.
 * Grava em <cwd>/uploads e devolve a URL pública servida pela própria API.
 * A URL usa PUBLIC_URL quando definida (ex.: IP da rede local em testes de
 * celular) — sem isso, cai no host da própria requisição, que quebra se a
 * retaguarda for acessada por localhost mas o app for testado em outro
 * dispositivo.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminUploadController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('arquivo', {
      storage: diskStorage({
        destination: join(process.cwd(), 'uploads'),
        filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = EXTENSOES.includes(extname(file.originalname).toLowerCase()) && file.mimetype.startsWith('image/');
        cb(ok ? null : new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou GIF de até 5MB'), ok);
      },
    }),
  )
  upload(@Req() req: Request, @UploadedFile() arquivo?: Express.Multer.File) {
    if (!arquivo) throw new BadRequestException('Nenhum arquivo enviado (campo: arquivo)');
    const base = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    return { url: `${base}/uploads/${arquivo.filename}` };
  }
}
