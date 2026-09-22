-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 029 — série e XML da NF-e recebida do Dlinks
-- O XML é guardado decodificado (não base64): ocupa ~25% menos, é legível
-- num select na hora de investigar, e o base64 não agrega nada.
-- =====================================================================

alter table pedido_notas add column if not exists serie text;
alter table pedido_notas add column if not exists xml   text;

insert into schema_migrations (versao) values ('029') on conflict do nothing;
