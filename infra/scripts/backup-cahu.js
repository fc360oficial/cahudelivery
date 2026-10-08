'use strict';
// Backup diário do CAHU Delivery, SEPARADO do Econômico Relatórios: zip próprio em D:\backups\cahu
// e pasta própria no Google Drive (gdrive-crypt:cahu/, criptografada pelo rclone crypt).
//
// Entra no zip:
//   - dump de cada banco PostgreSQL fluxo_* (pg_dump -Fc) + roles/senhas do Postgres (pg_dumpall --globals-only)
//   - apps/api/uploads (fotos de produtos, logos, banners)
//   - infra/caddy (HTTPS), apps/admin/.env.production
//   - parâmetros NSSM dos serviços FluxoAPI e PostgreSQL16 (comando, pasta, variáveis com senhas)
//   - infra/RESTAURAR-CAHU.md (roteiro de restauração)
// Retenção: 30 dias no servidor e no Drive. Senha do banco vem do registro do serviço FluxoAPI (NSSM),
// não fica em arquivo nenhum do repositório.
//
// Roda sozinho pela tarefa agendada do Windows "Backup CAHU" (04:30, como SYSTEM). Criar uma vez, em
// PowerShell como administrador:
//   schtasks /create /tn "Backup CAHU" /sc daily /st 04:30 /ru SYSTEM /rl HIGHEST /f /tr "\"C:\Program Files\nodejs\node.exe\" C:\cahudelivery\infra\scripts\backup-cahu.js"
// O Econômico Relatórios (C:\fc360\claude_code_\lib\backup.js, lista `extras`) lê o <destino>\estado.json
// gravado aqui pra mostrar o resultado na tela Processos › Backup e avisar se este backup parar; se o
// estado estiver com mais de 28 h (tarefa não existe ou quebrou), ele mesmo dispara este script às 04:00.
// Rodar na mão: node C:\cahudelivery\infra\scripts\backup-cahu.js
//
// Saída: a ÚLTIMA linha do stdout é um JSON {inicio, arquivo, bytes, nuvem, erro}, o mesmo registro que vai
// pro estado.json. Nunca lança: erro vai no JSON e o processo sai com código 1.
const fs = require('fs');
const path = require('path');
const util = require('util');
const cp = require('child_process');

const execFile = util.promisify(cp.execFile);
const EXEC = { windowsHide: true, maxBuffer: 32 * 1024 * 1024 };

const RAIZ = process.env.CAHU_RAIZ || 'C:/cahudelivery';
const DESTINO = process.env.CAHU_BACKUP_DEST || 'D:/backups/cahu';
const PG_BIN = process.env.PG_BIN || 'C:/PostgreSQL/16/bin';
const RCLONE = { exe: 'C:/fc360/tools/rclone/rclone.exe', conf: 'C:/fc360/tools/rclone/rclone.conf', remoto: 'gdrive-crypt:cahu' };
const SERVICOS = ['FluxoAPI', 'PostgreSQL16'];
const RETENCAO_DIAS = 30;
const TAR = fs.existsSync('C:/Windows/System32/tar.exe') ? 'C:/Windows/System32/tar.exe' : 'tar';

const log = (...a) => console.log('[BACKUP-CAHU]', ...a);

// Parâmetros de um serviço NSSM no registro. AppEnvironmentExtra (REG_MULTI_SZ) vira lista "CHAVE=valor".
async function lerServico(svc) {
  const { stdout } = await execFile('reg.exe', ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${svc}\\Parameters`], EXEC);
  const p = {};
  for (const linha of String(stdout).split(/\r?\n/)) {
    const m = linha.match(/^\s{4}(\S+)\s+(REG_\w+)\s+(.*)$/);
    if (m) p[m[1]] = m[2] === 'REG_MULTI_SZ' ? m[3].split('\\0').filter(Boolean) : m[3];
  }
  return p;
}

function envDoServico(p) {
  const env = {};
  for (const kv of p.AppEnvironmentExtra || []) {
    const i = kv.indexOf('=');
    if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return env;
}

function destinoReal() {
  try { fs.mkdirSync(DESTINO, { recursive: true }); fs.accessSync(DESTINO, fs.constants.W_OK); return DESTINO; }
  catch {
    const alt = path.resolve(RAIZ, '..', 'backups-cahu');
    fs.mkdirSync(alt, { recursive: true });
    return alt;
  }
}

function nomeArquivo(dest) {
  const d = new Date();
  const dia = d.toISOString().slice(0, 10);
  let nome = `cahu-${dia}.zip`;
  if (fs.existsSync(path.join(dest, nome))) {
    nome = `cahu-${dia}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.zip`;
  }
  return path.join(dest, nome);
}

function retencao(dest) {
  const limite = Date.now() - RETENCAO_DIAS * 864e5;
  for (const f of fs.readdirSync(dest)) {
    if (!/^cahu-.*\.zip$/.test(f)) continue;
    const p = path.join(dest, f);
    try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch (e) { log('retenção', f, e.message); }
  }
}

async function dumpBancos(tmp) {
  const fluxo = await lerServico('FluxoAPI');
  const env = envDoServico(fluxo);
  if (!env.DB_PASSWORD) throw new Error('DB_PASSWORD não encontrado nos parâmetros NSSM do FluxoAPI');
  const pgEnv = { ...process.env, PGPASSWORD: env.DB_PASSWORD };
  const con = ['-h', env.DB_HOST || '127.0.0.1', '-p', env.DB_PORT || '5432', '-U', env.DB_USER || 'postgres'];
  const psql = path.join(PG_BIN, 'psql.exe');
  const pgDump = path.join(PG_BIN, 'pg_dump.exe');
  const pgDumpAll = path.join(PG_BIN, 'pg_dumpall.exe');
  if (!fs.existsSync(pgDump)) throw new Error('pg_dump não encontrado em ' + PG_BIN);

  const { stdout } = await execFile(psql, [...con, '-w', '-Atc', "select datname from pg_database where datname like 'fluxo%' order by 1"], { ...EXEC, env: pgEnv });
  const bancos = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!bancos.length) throw new Error('nenhum banco fluxo_* encontrado no PostgreSQL');
  for (const db of bancos) {
    await execFile(pgDump, [...con, '-w', '-Fc', '-f', path.join(tmp, `${db}.dump`), db], { ...EXEC, env: pgEnv });
    log('dump', db, (fs.statSync(path.join(tmp, `${db}.dump`)).size / 1048576).toFixed(1), 'MB');
  }
  // roles e senhas do Postgres (usuário postgres, etc.)
  await execFile(pgDumpAll, [...con, '-w', '--globals-only', '-f', path.join(tmp, 'globals.sql')], { ...EXEC, env: pgEnv });
  return bancos;
}

async function exportarServicos(tmp) {
  const out = { geradoEm: new Date().toISOString(), servicos: {} };
  for (const svc of SERVICOS) {
    try { out.servicos[svc] = await lerServico(svc); } catch (e) { log('serviço', svc, 'não lido:', e.message); }
  }
  fs.writeFileSync(path.join(tmp, 'servicos-nssm.json'), JSON.stringify(out, null, 2));
}

async function gerarZip(tmp, arquivo) {
  const alvo = arquivo + '.tmp';
  const args = ['--format=zip', '-cf', alvo, '-C', tmp, ...fs.readdirSync(tmp)];
  const extras = [
    [path.join(RAIZ, 'apps/api'), 'uploads'],
    [path.join(RAIZ, 'infra'), 'caddy'],
    [path.join(RAIZ, 'infra'), 'RESTAURAR-CAHU.md'],
    [path.join(RAIZ, 'apps/admin'), '.env.production'],
  ];
  for (const [dir, nome] of extras) if (fs.existsSync(path.join(dir, nome))) args.push('-C', dir, nome);
  try {
    await execFile(TAR, args, EXEC);
    fs.renameSync(alvo, arquivo);
  } catch (e) {
    try { fs.unlinkSync(alvo); } catch {}
    throw e;
  }
}

async function enviarNuvem(arquivo) {
  if (!fs.existsSync(RCLONE.exe) || !fs.existsSync(RCLONE.conf)) return { status: 'nao-configurada' };
  const base = ['--config', RCLONE.conf];
  await execFile(RCLONE.exe, [...base, 'copy', arquivo, RCLONE.remoto, '--drive-chunk-size', '64M'], EXEC);
  await execFile(RCLONE.exe, [...base, 'delete', RCLONE.remoto, '--min-age', RETENCAO_DIAS + 'd'], EXEC);
  return { status: 'ok', em: new Date().toISOString() };
}

// <destino>/estado.json: último registro + histórico de 30. É o que o Econômico lê pra tela.
function gravarEstado(dest, reg) {
  const p = path.join(dest, 'estado.json');
  let st = { ultimo: null, historico: [] };
  try { st = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
  st.ultimo = reg;
  st.historico = [reg, ...(st.historico || [])].slice(0, 30);
  fs.writeFileSync(p, JSON.stringify(st, null, 2));
}

async function main() {
  const reg = { inicio: new Date().toISOString(), arquivo: null, bytes: 0, bancos: [], nuvem: null, erro: null };
  const dest = destinoReal();
  const tmp = path.join(dest, 'tmp-' + process.pid);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    reg.bancos = await dumpBancos(tmp);
    await exportarServicos(tmp);
    const arquivo = nomeArquivo(dest);
    await gerarZip(tmp, arquivo);
    reg.arquivo = arquivo;
    reg.bytes = fs.statSync(arquivo).size;
    retencao(dest);
    try { reg.nuvem = await enviarNuvem(arquivo); }
    catch (e) { reg.nuvem = { status: 'erro', erro: e.message }; log('nuvem:', e.message); }
  } catch (e) {
    reg.erro = e.message;
    log('ERRO', e.message);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  reg.fim = new Date().toISOString();
  try { gravarEstado(dest, reg); } catch (e) { log('estado.json:', e.message); }
  log(reg.erro ? 'falhou' : `${(reg.bytes / 1048576).toFixed(1)} MB → ${reg.arquivo} | nuvem: ${reg.nuvem && reg.nuvem.status}`);
  console.log(JSON.stringify(reg));
  process.exitCode = reg.erro ? 1 : 0;
}

main();
