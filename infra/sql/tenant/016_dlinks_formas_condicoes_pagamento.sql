-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 016 — formas e condições de pagamento empurradas pelo Dlinks (Fase 4d)
-- Tabelas novas: hoje isso vivia só como config solta (condicoes_boleto em
-- configuracoes) — o Dlinks manda a lista real com código próprio.
-- =====================================================================

create table if not exists formas_pagamento_erp (
  id                       uuid primary key default gen_random_uuid(),
  erp_forma_pagamento_id   text not null unique,
  descricao                text not null
);

create table if not exists condicoes_pagamento_erp (
  id                  uuid primary key default gen_random_uuid(),
  erp_condicao_id     text not null unique,
  descricao           text not null,
  forma_pagamento_id  uuid not null references formas_pagamento_erp(id)
);

insert into schema_migrations (versao) values ('016') on conflict do nothing;
