-- Seção "Vencimento Próximo" (benchmark Praso, 24/07/2026): data de validade
-- por produto (não por lote). Exclusivo do CAHU Delivery — não sincroniza com o ERP.
alter table produtos add column if not exists data_validade date;

insert into schema_migrations (versao) values ('009') on conflict do nothing;
