-- =====================================================================
-- Fluxo Commerce — Banco de CONTROLE (fluxo_control)
-- Migração 002 — credenciais de integração inbound (ex.: apikey do Dlinks)
-- =====================================================================

create table if not exists integracao_credenciais (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  adaptador     text not null default 'dlinks',
  apikey_hash   text not null unique,   -- sha256 hex da apikey em texto puro
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_integracao_credenciais_tenant on integracao_credenciais (tenant_id);

insert into schema_migrations (versao) values ('002') on conflict do nothing;
