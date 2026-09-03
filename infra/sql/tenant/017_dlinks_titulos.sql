-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 017 — títulos em aberto empurrados pelo Dlinks (Fase 4d, /titulos)
-- =====================================================================

create table if not exists titulos_cliente (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references clientes(id),
  erp_titulo_id  text not null unique,
  valor          numeric(12,2) not null,
  vencimento     date not null,
  status         text not null,
  atualizado_em  timestamptz not null default now()
);

create index if not exists idx_titulos_cliente on titulos_cliente (cliente_id);

insert into schema_migrations (versao) values ('017') on conflict do nothing;
