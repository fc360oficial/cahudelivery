-- infra/sql/tenant/038_vendedor_faturamento_mensal.sql
-- Fluxo Vendas, retaguarda (11/11/2026): faturamento mensal por vendedor enviado pelo ERP.
-- Os vendedores usavam outra ferramenta até agora, então o nosso banco não tem o faturado do mês anterior deles;
-- o ERP manda o total faturado por vendedor e por mês (POST /v1/integracoes/dlinks/vendas-vendedores) e ele
-- serve de base da meta do mês (base do mês anterior x (1 + percentual/100)).
-- Repetível: pode rodar mais de uma vez.

create table if not exists vendedor_faturamento_mensal (
  vendedor_id   uuid not null references vendedores(id) on delete cascade,
  ano_mes       text not null check (ano_mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  valor         numeric(14,2) not null check (valor >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (vendedor_id, ano_mes)
);

insert into schema_migrations (versao) values ('038') on conflict do nothing;
