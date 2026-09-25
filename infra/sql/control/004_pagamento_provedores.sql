-- infra/sql/control/004_pagamento_provedores.sql
-- Provedor de pagamento online por tenant. config_json guarda só o que não é
-- segredo (chave PIX, expiração, caminho do arquivo de credencial no servidor
-- e o sha256 do segredo do webhook). O arquivo de credencial fica fora do repo.
create table if not exists pagamento_provedores (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  provedor    text not null,                         -- itau_pix | mock
  ativo       boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  unique (tenant_id, provedor)
);

insert into schema_migrations (versao) values ('004') on conflict do nothing;
