-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 014 — suporte a upsert do catálogo empurrado pelo Dlinks
-- (Fase 4b: POST /grupos, /fornecedores, /produtos, /tabelas-de-precos, /precos)
-- =====================================================================

-- erp_categoria_id/erp_marca_id/erp_tabela_id já existiam mas sem constraint
-- única — necessária para o "on conflict" do upsert vindo do Dlinks.
alter table categorias add constraint categorias_erp_categoria_id_key unique (erp_categoria_id);
alter table marcas add constraint marcas_erp_marca_id_key unique (erp_marca_id);
alter table tabelas_preco add constraint tabelas_preco_erp_tabela_id_key unique (erp_tabela_id);

-- percentuais máximos de negociação por preço, enviados pelo Dlinks em /precos
alter table precos add column if not exists percentual_max_desconto numeric(5,2);
alter table precos add column if not exists percentual_max_acrescimo numeric(5,2);

insert into schema_migrations (versao) values ('014') on conflict do nothing;
