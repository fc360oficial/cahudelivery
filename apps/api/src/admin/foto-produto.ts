import sharp from 'sharp';
import { readFile, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

/**
 * Padrão único das fotos de produto, independente de como a foto chegou
 * (celular, internet, catálogo do fornecedor):
 *  - recorta a margem branca em volta do produto (foto de catálogo costuma vir
 *    com muito espaço vazio) e encaixa o produto ocupando sempre a MESMA área
 *    do quadro (ÁREA_PRODUTO), pra nenhum item parecer maior ou menor que o
 *    vizinho na vitrine (Tiago, 30/09/2026: "tem que estar tudo padrão");
 *  - quadrado 1000x1000, foto inteira centralizada sobre fundo branco (nada cortado);
 *  - JPEG qualidade 85, sem metadados (uma foto de 4MB vira ~100KB);
 *  - miniatura 300x300 no mesmo enquadramento pra vitrine/carrinho.
 * Banners e logos de patrocinador NÃO passam por aqui (não são quadrados).
 */
export const TAMANHO_FOTO = 1000;
export const TAMANHO_MINIATURA = 300;
/** Fração do quadro que o produto ocupa no lado maior (o resto é respiro branco). */
export const AREA_PRODUTO = 0.84;
const BRANCO = { r: 255, g: 255, b: 255, alpha: 1 };

export interface FotoPadronizada {
  arquivo: string; // nome do arquivo 1000x1000 (.jpg)
  miniatura: string; // nome do arquivo 300x300 (.jpg)
}

/**
 * Bytes do quadrado 1000x1000 padronizado a partir de qualquer imagem.
 * Exportado pra reprocessar fotos antigas (infra/scripts/repadronizar-fotos.js).
 */
export async function quadradoPadrao(original: Buffer): Promise<Buffer> {
  // rotate() sem argumento aplica a orientação EXIF (foto de celular deitada).
  // flatten antes do trim: PNG com fundo transparente vira branco e o recorte enxerga a margem.
  const base = sharp(original, { failOn: 'none' }).rotate().flatten({ background: BRANCO });
  let produto: Buffer;
  try {
    // trim: tira a borda da cor do canto (branco/quase branco). threshold tolera JPEG sujo.
    produto = await base.clone().trim({ background: BRANCO, threshold: 28 }).toBuffer();
  } catch {
    // imagem toda branca (ou trim sem nada pra tirar em versões antigas do sharp): segue sem recorte
    produto = await base.clone().toBuffer();
  }
  const lado = Math.round(TAMANHO_FOTO * AREA_PRODUTO);
  const ajustado = await sharp(produto)
    .resize(lado, lado, { fit: 'contain', background: BRANCO, withoutEnlargement: false })
    .toBuffer();
  const margem = Math.round((TAMANHO_FOTO - lado) / 2);
  return sharp(ajustado)
    .extend({ top: margem, bottom: TAMANHO_FOTO - lado - margem, left: margem, right: TAMANHO_FOTO - lado - margem, background: BRANCO })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

/** Gera as duas versões a partir do arquivo original e apaga o original. */
export async function padronizarFotoProduto(caminhoOriginal: string): Promise<FotoPadronizada> {
  const pasta = dirname(caminhoOriginal);
  const nomeBase = basename(caminhoOriginal, extname(caminhoOriginal));
  const arquivo = `${nomeBase}.jpg`;
  const miniatura = `${nomeBase}-m.jpg`;

  // Lê o original inteiro em memória: se ele já for .jpg, a saída tem o MESMO nome
  // e o sharp recusa gravar por cima do arquivo que está lendo.
  const grande = await quadradoPadrao(await readFile(caminhoOriginal));
  await sharp(grande).toFile(join(pasta, arquivo));
  await sharp(grande)
    .resize(TAMANHO_MINIATURA, TAMANHO_MINIATURA, { fit: 'contain', background: BRANCO })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(pasta, miniatura));

  if (basename(caminhoOriginal) !== arquivo) {
    await unlink(caminhoOriginal).catch(() => undefined);
  }
  return { arquivo, miniatura };
}

/**
 * Imagem de categoria: no app ela é o FUNDO do card (proporção ~1.4, nome por cima),
 * então aqui é corte central 3:2 (900x600), sem borda branca. JPEG q82.
 */
export async function padronizarImagemCategoria(caminhoOriginal: string): Promise<{ arquivo: string }> {
  const pasta = dirname(caminhoOriginal);
  const nomeBase = basename(caminhoOriginal, extname(caminhoOriginal));
  const arquivo = `${nomeBase}.jpg`;
  await sharp(await readFile(caminhoOriginal), { failOn: 'none' })
    .rotate()
    .resize(900, 600, { fit: 'cover', position: 'centre' })
    .flatten({ background: BRANCO })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(pasta, arquivo));
  if (basename(caminhoOriginal) !== arquivo) await unlink(caminhoOriginal).catch(() => undefined);
  return { arquivo };
}
