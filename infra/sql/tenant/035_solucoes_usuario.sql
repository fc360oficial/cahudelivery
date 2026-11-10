-- infra/sql/tenant/035_solucoes_usuario.sql
-- Fluxo Vendas, retaguarda (10/11/2026): acesso por solução.
--  * usuarios_admin.solucoes diz a quais painéis o usuário entra: 'delivery' e/ou 'vendas';
--  * quem já existia continua com Delivery (default); papel admin recebe as duas.
-- Repetível: pode rodar mais de uma vez.

alter table usuarios_admin add column if not exists solucoes text[] not null default '{delivery}';

alter table usuarios_admin drop constraint if exists usuarios_admin_solucoes_check;
alter table usuarios_admin add constraint usuarios_admin_solucoes_check
  check (solucoes <@ array['delivery','vendas']::text[] and cardinality(solucoes) > 0);

update usuarios_admin set solucoes = '{delivery,vendas}' where papel = 'admin' and solucoes <> '{delivery,vendas}';

insert into schema_migrations (versao) values ('035') on conflict do nothing;
