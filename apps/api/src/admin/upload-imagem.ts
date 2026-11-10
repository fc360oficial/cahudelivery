import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { diskStorage } from 'multer';
import { extname, join } from 'node:path';
import { padronizarFotoProduto, padronizarImagemCategoria } from './foto-produto';

const EXTENSOES = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

/** Opções do FileInterceptor('arquivo') do upload de imagens: mesma pasta, tipos e limite nos painéis de Delivery e Vendas. */
export function opcoesUploadImagem() {
  return {
    storage: diskStorage({
      destination: join(process.cwd(), 'uploads'),
      filename: (_req, file, cb) => cb(null, `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
      const ok = EXTENSOES.includes(extname(file.originalname).toLowerCase()) && file.mimetype.startsWith('image/');
      cb(ok ? null : new BadRequestException('Envie uma imagem PNG, JPG, WEBP ou GIF de até 5MB'), ok);
    },
  };
}

/** Pós-processa o arquivo recebido e devolve a URL pública (PUBLIC_URL ou host da requisição). */
export async function responderUploadImagem(req: Request, tipo: string | undefined, arquivo?: Express.Multer.File) {
  if (!arquivo) throw new BadRequestException('Nenhum arquivo enviado (campo: arquivo)');
  const base = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
  // Foto de produto: padroniza (quadrado 1000x1000 fundo branco + miniatura). Banner/logo fica como veio.
  if (tipo === 'produto') {
    const { arquivo: nome, miniatura } = await padronizarFotoProduto(arquivo.path);
    return { url: `${base}/uploads/${nome}`, urlMiniatura: `${base}/uploads/${miniatura}` };
  }
  if (tipo === 'categoria') {
    const { arquivo: nome } = await padronizarImagemCategoria(arquivo.path);
    return { url: `${base}/uploads/${nome}` };
  }
  return { url: `${base}/uploads/${arquivo.filename}` };
}
