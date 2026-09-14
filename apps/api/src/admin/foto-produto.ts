import sharp from 'sharp';
import { readFile, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/**
 * Padrão único das fotos de produto, independente de como a foto chegou
 * (celular, internet, catálogo do fornecedor):
 *  - quadrado 1000x1000, foto inteira centralizada sobre fundo branco (nada cortado);
 *  - JPEG qualidade 85, sem metadados (uma foto de 4MB vira ~100KB);
 *  - miniatura 300x300 no mesmo enquadramento pra vitrine/carrinho.
 * Banners e logos de patrocinador NÃO passam por aqui (não são quadrados).
 */
export const TAMANHO_FOTO = 1000;
export const TAMANHO_MINIATURA = 300;
const BRANCO = { r: 255, g: 255, b: 255, alpha: 1 };

export interface FotoPadronizada {
  arquivo: string; // nome do arquivo 1000x1000 (.jpg)
  miniatura: string; // nome do arquivo 300x300 (.jpg)
}

/** Gera as duas versões a partir do arquivo original e apaga o original. */
export async function padronizarFotoProduto(caminhoOriginal: string): Promise<FotoPadronizada> {
  const pasta = dirname(caminhoOriginal);
  const nomeBase = basename(caminhoOriginal, extname(caminhoOriginal));
  const arquivo = `${nomeBase}.jpg`;
  const miniatura = `${nomeBase}-m.jpg`;

  // Lê o original inteiro em memória: se ele já for .jpg, a saída tem o MESMO nome
  // e o sharp recusa gravar por cima do arquivo que está lendo.
  // rotate() sem argumento aplica a orientação EXIF (foto de celular deitada).
  const origem = sharp(await readFile(caminhoOriginal), { failOn: 'none' }).rotate();

  await origem
    .clone()
    .resize(TAMANHO_FOTO, TAMANHO_FOTO, { fit: 'contain', background: BRANCO, withoutEnlargement: false })
    .flatten({ background: BRANCO })
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(join(pasta, arquivo));

  await origem
    .clone()
    .resize(TAMANHO_MINIATURA, TAMANHO_MINIATURA, { fit: 'contain', background: BRANCO })
    .flatten({ background: BRANCO })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(pasta, miniatura));

  if (basename(caminhoOriginal) !== arquivo) {
    await unlink(caminhoOriginal).catch(() => undefined);
  }
  return { arquivo, miniatura };
}
