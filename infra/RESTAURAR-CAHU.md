# Como restaurar o CAHU Delivery do zero

Roteiro pra quando o servidor de aplicação (o .254) morrer ou for trocado. O backup do CAHU é
**separado** do Econômico Relatórios: zip próprio, gerado todo dia por `infra/scripts/backup-cahu.js`.

## O que está onde

| O quê | Onde fica | Como volta |
|---|---|---|
| Código (API NestJS, admin, app Flutter) | GitHub, monorepo `cahudelivery` | `git clone` + build |
| Bancos `fluxo_control` e `fluxo_t_cahu` (clientes, pedidos, produtos, pagamentos) | zip diário `cahu-AAAA-MM-DD.zip` → `*.dump` | `pg_restore` (passo 3) |
| Roles/senhas do PostgreSQL | zip → `globals.sql` | `psql -f globals.sql` |
| Fotos, logos, banners | zip → `uploads/` | copiar pra `apps/api/uploads` |
| HTTPS (Caddy) | zip → `caddy/cahudelivery.caddy` | copiar pra `infra/caddy` |
| Variáveis do serviço (senha do banco, JWT_SECRET, PUBLIC_URL...) | zip → `servicos-nssm.json` | usar nos `nssm set` do passo 5 |
| `.env.production` do admin | zip | copiar pra `apps/admin/` |

O zip fica em dois lugares:
- `D:\backups\cahu\` no próprio servidor (30 dias);
- Google Drive da conta `processosredeeconomico@gmail.com`, pasta `Backups/EconomicoRelatorios/cahu`,
  **criptografado com rclone crypt** (30 dias). A senha do crypt é a mesma do Econômico (cofre do Tiago,
  item "rclone crypt Econômico"). Sem ela o arquivo do Drive não abre; use o zip do D:.

## 1. Programas

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id PostgreSQL.PostgreSQL.16 -e     # ou instalador do EDB; anotar a senha do postgres
winget install --id NSSM.NSSM -e
```

## 2. Código

```powershell
git clone <url-do-repo> C:\cahudelivery
cd C:\cahudelivery
npm ci
npm run build -w apps/api          # gera apps/api/dist/main.js
```

## 3. Pegar o zip e restaurar os bancos

Do D: do servidor antigo, ou do Drive (como no RESTAURAR.md do Econômico, mas com
`rclone copy gdrive-crypt:cahu/cahu-<data>.zip C:\cahudelivery\restore\`).

```powershell
mkdir C:\cahudelivery\restore\zip
tar -xf C:\cahudelivery\restore\cahu-<data>.zip -C C:\cahudelivery\restore\zip
cd C:\cahudelivery\restore\zip
$env:PGPASSWORD = '<senha do postgres do Postgres novo>'
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h 127.0.0.1 -f globals.sql
foreach ($db in 'fluxo_control','fluxo_t_cahu') {
  & "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -h 127.0.0.1 $db
  & "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe" -U postgres -h 127.0.0.1 -d $db --no-owner "$db.dump"
}
```

Conferir: `psql -U postgres -d fluxo_t_cahu -c "select count(*) from pedidos"` (ou outra tabela conhecida).

## 4. Arquivos de volta no lugar

```powershell
Copy-Item -Recurse C:\cahudelivery\restore\zip\uploads  C:\cahudelivery\apps\api\uploads
Copy-Item          C:\cahudelivery\restore\zip\caddy\*  C:\cahudelivery\infra\caddy\
Copy-Item          C:\cahudelivery\restore\zip\.env.production C:\cahudelivery\apps\admin\
```

## 5. Serviço da API (NSSM)

Abrir `servicos-nssm.json` do zip: a chave `FluxoAPI.AppEnvironmentExtra` tem a lista exata de variáveis
(`PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `PUBLIC_URL`...). Se a senha do
postgres do Postgres novo for outra, trocar `DB_PASSWORD` por ela (ou recriar a senha antiga no Postgres).

```powershell
nssm install FluxoAPI "C:\Program Files\nodejs\node.exe" "C:\cahudelivery\apps\api\dist\main.js"
nssm set FluxoAPI AppDirectory C:\cahudelivery\apps\api
nssm set FluxoAPI AppEnvironmentExtra PORT=3000 DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=<do json> JWT_SECRET=<do json> PUBLIC_URL=<do json>
nssm start FluxoAPI
```

Teste: `curl http://localhost:3000/` responde.

## 6. HTTPS

O `cahudelivery.caddy` é importado pelo Caddyfile do Econômico (serviço `Caddy`); ver RESTAURAR.md do
Econômico, passo 6. DNS `cahudelivery.duckdns.org` precisa apontar pro IP público novo.

## 7. Validar

1. Abrir o admin e logar.
2. Produtos aparecem com foto (uploads voltaram).
3. Fazer um pedido de teste no app.
4. Rodar `node C:\cahudelivery\infra\scripts\backup-cahu.js` e ver o zip novo em `D:\backups\cahu`.
