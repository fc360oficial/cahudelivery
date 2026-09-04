-- =====================================================================
-- Fluxo Commerce — Banco de CONTROLE (fluxo_control)
-- Migração 003 — adaptador de ERP por tenant
-- Antes disso, integration.service.ts decidia o adaptador com
-- `slug === 'cahu' ? DlinksPullAdapter : DevMockAdapter` fixo no código.
-- Vira config, pronto pra um 2º cliente sem precisar mexer em código.
-- =====================================================================

alter table tenants add column if not exists adaptador_erp text not null default 'mock'
  check (adaptador_erp in ('mock', 'dlinks'));

update tenants set adaptador_erp = 'dlinks' where slug = 'cahu';

insert into schema_migrations (versao) values ('003') on conflict do nothing;
