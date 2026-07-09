# Fluxo Commerce

Plataforma white label de vendas B2B para distribuidoras. Primeiro cliente: **CAHU Distribuidora** (app *CAHU Delivery*).

> Documentação completa de arquitetura, escopo e cronograma: pastas `01 - Documentação` e `02 - Planejamento` (nível acima deste repo).

## Estrutura

```
apps/
  api/      # API NestJS (auth, catálogo, pedidos, admin, integração ERP)
  admin/    # Retaguarda web (React + TypeScript + Vite)
  mobile/   # App Flutter (Android + iOS, white label)
packages/
  erp-adapters/   # Adaptadores de ERP (contrato ErpAdapter) — 1º: Dlinks
  shared-types/   # DTOs compartilhados API ↔ retaguarda
infra/
  scripts/  # Provisionamento de tenant, migrações por tenant
```

## Desenvolvimento

```bash
npm install            # instala api + admin + packages (workspaces)
npm run api            # API em modo watch (porta 3000)
npm run admin          # retaguarda (porta 5173)
```

Banco local: PostgreSQL 16 — `fluxo_control` (controle) + `fluxo_t_cahu` (tenant CAHU).
Migrações: `11 - SQL/control` e `11 - SQL/tenant`, aplicadas por `infra/scripts/provisionar-tenant.ps1`.
