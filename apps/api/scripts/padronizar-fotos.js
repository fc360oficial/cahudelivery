#!/usr/bin/env node
/**
 * Reprocessa as fotos de produto já cadastradas pro padrão novo (1000x1000 fundo branco
 * + miniatura 300x300). Roda uma vez por banco, depois o upload já grava padronizado.
 *
 * Só mexe em fotos servidas pela própria API (/uploads/...). URLs externas (http de
 * terceiros) são puladas — não há arquivo local pra tratar.
 *
 * Uso (na pasta apps/api, depois de `npx nest build`):
 *   node scripts/padronizar-fotos.js --db postgres://USUARIO:SENHA@127.0.0.1:5432/fluxo_t_cahu \
 *        --uploads C:\cahudelivery\apps\api\uploads [--dry-run]
 *
 * Idempotente: pula linhas que já têm url_miniatura.
 */
const { Client } = require('pg');
const { existsSync } = require('node:fs');
const { join, basename } = require('node:path');
const { padronizarFotoProduto } = require('../dist/admin/foto-produto');

function arg(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : padrao;
}
const db = arg('--db');
const uploads = arg('--uploads', join(process.cwd(), 'uploads'));
const dryRun = process.argv.includes('--dry-run');
if (!db) {
  console.error('Faltou --db postgres://usuario:senha@host:5432/banco');
  process.exit(1);
}

(async () => {
  const client = new Client({ connectionString: db });
  await client.connect();
  const { rows } = await client.query(
    `select id, url from produto_imagens where url_miniatura is null order by produto_id, ordem`,
  );
  console.log(`${rows.length} foto(s) sem miniatura`);
  let ok = 0, puladas = 0, erros = 0;
  for (const r of rows) {
    const m = /\/uploads\/([^/?#]+)$/.exec(r.url ?? '');
    if (!m) { puladas++; continue; } // URL externa
    const caminho = join(uploads, m[1]);
    if (!existsSync(caminho)) { console.warn(`arquivo ausente: ${caminho}`); puladas++; continue; }
    if (dryRun) { console.log(`[dry-run] ${basename(caminho)}`); ok++; continue; }
    try {
      const { arquivo, miniatura } = await padronizarFotoProduto(caminho);
      const novaUrl = r.url.replace(/\/uploads\/[^/?#]+$/, `/uploads/${arquivo}`);
      const novaMini = r.url.replace(/\/uploads\/[^/?#]+$/, `/uploads/${miniatura}`);
      await client.query(`update produto_imagens set url = $2, url_miniatura = $3 where id = $1`, [r.id, novaUrl, novaMini]);
      ok++;
      console.log(`ok  ${basename(caminho)} -> ${arquivo}`);
    } catch (e) {
      erros++;
      console.error(`ERRO ${basename(caminho)}: ${e.message}`);
    }
  }
  await client.end();
  console.log(`\nconcluído: ${ok} processada(s), ${puladas} pulada(s), ${erros} erro(s)`);
})();
