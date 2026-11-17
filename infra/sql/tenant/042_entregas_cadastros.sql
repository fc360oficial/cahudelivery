-- infra/sql/tenant/042_entregas_cadastros.sql
-- Fluxo Entregas, fase 1, etapa 1 (17/11/2026): a solução "entregas" na retaguarda e os cadastros que a
-- montagem de carga vai usar.
--  * usuarios_admin.solucoes passa a aceitar 'entregas'; administradores recebem as três soluções;
--  * motoristas: quem dirige e entra no aplicativo Fluxo Entregas. Login e senha são definidos na
--    retaguarda, como o vendedor do Fluxo Vendas;
--  * caminhoes: os veículos da distribuidora, com o peso que levam, o motorista e a região de costume;
--  * refresh_tokens passa a aceitar o sujeito 'motorista' (sessão do aplicativo, etapa do app).
-- APLICAR ANTES de publicar a API desta etapa: ela grava 'entregas' em usuarios_admin.solucoes ao salvar
-- um administrador, e a restrição antiga recusaria.
-- Não altera dados de Delivery nem de Vendas. Repetível: pode rodar mais de uma vez.

set lock_timeout = '5s';

alter table usuarios_admin drop constraint if exists usuarios_admin_solucoes_check;
alter table usuarios_admin add constraint usuarios_admin_solucoes_check
  check (solucoes <@ array['delivery','vendas','entregas']::text[] and cardinality(solucoes) > 0);

update usuarios_admin set solucoes = '{delivery,vendas,entregas}'
 where papel = 'admin' and solucoes <> '{delivery,vendas,entregas}';

-- Mesma lista da 034, mais 'motorista'.
alter table refresh_tokens drop constraint if exists refresh_tokens_sujeito_check;
alter table refresh_tokens add constraint refresh_tokens_sujeito_check
  check (sujeito in ('cliente','admin','vendedor','motorista'));

reset lock_timeout;

create table if not exists motoristas (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  telefone         text,
  login            text unique,                 -- definido na retaguarda; nulo = ainda sem acesso ao app
  senha_hash       text,                        -- argon2id
  ativo            boolean not null default true,
  ultimo_acesso_em timestamptz,
  app_versao       text,
  criado_em        timestamptz not null default now()
);

create table if not exists caminhoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,                 -- como aparece nas telas ("Caminhão 2")
  placa          text,                          -- só letras e números, maiúsculas (ABC1D23)
  capacidade_kg  numeric(10,2) check (capacidade_kg is null or capacidade_kg > 0),
  motorista_id   uuid references motoristas(id) on delete set null,  -- motorista de costume
  regiao         text,                          -- região de costume (a sugestão de carga dá preferência)
  situacao       text not null default 'ativo' check (situacao in ('ativo','manutencao','inativo')),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

create unique index if not exists caminhoes_nome_unico on caminhoes (lower(nome));
create unique index if not exists caminhoes_placa_unica on caminhoes (placa) where placa is not null;
create index if not exists caminhoes_motorista on caminhoes (motorista_id);

insert into schema_migrations (versao) values ('042') on conflict do nothing;
