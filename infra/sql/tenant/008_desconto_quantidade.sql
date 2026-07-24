-- Desconto progressivo por quantidade (benchmark Praso, 23/07/2026): preço
-- menor por caixa/fardo a partir de uma quantidade mínima. Um único nível
-- por produto. Exclusivo do CAHU Delivery — não sincroniza com o ERP.
alter table produtos add column if not exists desconto_qtd_minima int;
alter table produtos add column if not exists desconto_qtd_preco numeric;

insert into schema_migrations (versao) values ('008') on conflict do nothing;