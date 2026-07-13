# Migrações SQL (fonte versionada)

Espelho versionado da pasta `CAHU DELIVERY\11 - SQL` (documentação do projeto).
**Regra:** toda mudança de schema entra AQUI e na pasta `11 - SQL` juntas —
este diretório é a fonte reproduzível para provisionar tenant/controle novos
(`infra/scripts/provisionar-tenant.ps1` deve apontar para estes arquivos).

- `control/` — banco `fluxo_control` (tenants, temas).
- `tenant/` — um banco por distribuidora (dev: `fluxo_t_cahu`); aplicar em ordem numérica.

Aplicação manual em dev:

```powershell
$env:PGPASSWORD='postgres'
psql -U postgres -d fluxo_t_cahu -f infra/sql/tenant/002_carrinho_anonimo.sql
```
