// Reprocessa fotos de produto já publicadas com o padrão novo (recorte da margem
// branca + produto ocupando 84% do quadro). Mesma regra de apps/api/src/admin/foto-produto.ts.
//
// Uso (no servidor, cmd):
//   node infra\scripts\repadronizar-fotos.js <lista.txt> <pasta uploads> <pasta backup>
// lista.txt = uma URL (ou nome de arquivo) da foto grande por linha, exportado do banco:
//   psql ... -A -t -c "select url from produto_imagens" > lista.txt
// Cada foto: copia o original pra pasta de backup (se ainda não existir lá), regrava o
// 1000x1000 e a miniatura -m.jpg com o mesmo nome (URLs no banco não mudam). Idempotente.
const sharp = require('sharp');
const { readFile, writeFile, copyFile, mkdir, access } = require('node:fs/promises');
const { join, basename } = require('node:path');

const TAMANHO_FOTO = 1000, TAMANHO_MINIATURA = 300, AREA_PRODUTO = 0.84;
const BRANCO = { r: 255, g: 255, b: 255, alpha: 1 };

async function quadradoPadrao(original) {
  const base = sharp(original, { failOn: 'none' }).rotate().flatten({ background: BRANCO });
  let produto;
  try { produto = await base.clone().trim({ background: BRANCO, threshold: 28 }).toBuffer(); }
  catch { produto = await base.clone().toBuffer(); }
  const lado = Math.round(TAMANHO_FOTO * AREA_PRODUTO);
  const ajustado = await sharp(produto).resize(lado, lado, { fit: 'contain', background: BRANCO }).toBuffer();
  const margem = Math.round((TAMANHO_FOTO - lado) / 2);
  return sharp(ajustado)
    .extend({ top: margem, bottom: TAMANHO_FOTO - lado - margem, left: margem, right: TAMANHO_FOTO - lado - margem, background: BRANCO })
    .jpeg({ quality: 85, mozjpeg: true }).toBuffer();
}

async function existe(p) { try { await access(p); return true; } catch { return false; } }

(async () => {
  const [lista, pasta, backup] = process.argv.slice(2);
  if (!lista || !pasta || !backup) { console.error('uso: node repadronizar-fotos.js <lista.txt> <uploads> <backup>'); process.exit(2); }
  await mkdir(backup, { recursive: true });
  const nomes = [...new Set((await readFile(lista, 'utf8')).split(/\r?\n/).map((l) => basename(l.trim())).filter((n) => n && n.endsWith('.jpg')))];
  let ok = 0, pulados = 0, erros = 0;
  for (const nome of nomes) {
    const caminho = join(pasta, nome);
    if (!(await existe(caminho))) { pulados++; console.log('não achei', nome); continue; }
    try {
      const bak = join(backup, nome);
      if (!(await existe(bak))) await copyFile(caminho, bak); // backup só do original, nunca sobrescreve
      const grande = await quadradoPadrao(await readFile(bak));
      await writeFile(caminho, grande);
      const mini = await sharp(grande).resize(TAMANHO_MINIATURA, TAMANHO_MINIATURA, { fit: 'contain', background: BRANCO }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      await writeFile(join(pasta, nome.replace(/\.jpg$/, '-m.jpg')), mini);
      ok++;
    } catch (e) { erros++; console.log('ERRO', nome, e.message); }
  }
  console.log(`fotos reprocessadas: ${ok}, não encontradas: ${pulados}, erros: ${erros} (backup em ${backup})`);
})();
