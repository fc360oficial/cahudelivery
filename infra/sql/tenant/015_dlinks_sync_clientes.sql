-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 015 — suporte a upsert de clientes empurrados pelo Dlinks (Fase 4c)
-- =====================================================================

alter table clientes add column if not exists limite_credito numeric(12,2);
alter table clientes add column if not exists saldo_titulos_aberto numeric(12,2);

insert into schema_migrations (versao) values ('015') on conflict do nothing;
