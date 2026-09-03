-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 018 — valores/itens reais do faturamento (POST /pedidos-faturados)
-- Guardado à parte de pedido_itens (que reflete o que foi PEDIDO, não
-- necessariamente o que foi faturado — pode haver substituição/corte de item).
-- =====================================================================

create table if not exists pedido_faturamentos (
  pedido_id   uuid primary key references pedidos(id),
  subtotal    numeric(12,2) not null,
  desconto    numeric(12,2) not null default 0,
  total       numeric(12,2) not null,
  itens_json  jsonb not null,
  faturado_em timestamptz not null default now()
);

insert into schema_migrations (versao) values ('018') on conflict do nothing;
