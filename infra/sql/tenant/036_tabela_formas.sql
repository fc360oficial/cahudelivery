-- infra/sql/tenant/036_tabela_formas.sql
-- Fluxo Vendas, retaguarda (10/11/2026): a tabela de preço manda no prazo; o pedido leva só a FORMA de pagamento.
--  * tabela_preco_formas diz quais formas de pagamento cada tabela aceita;
--  * pedidos e orcamentos guardam a forma escolhida (forma_pagamento_erp_id);
--  * condicao_pagamento_id continua nas duas tabelas (nulo, sem uso); tabela_preco_condicoes fica como está.
-- Repetível: pode rodar mais de uma vez.

create table if not exists tabela_preco_formas (
  tabela_preco_id    uuid not null references tabelas_preco(id) on delete cascade,
  forma_pagamento_id uuid not null references formas_pagamento_erp(id) on delete cascade,
  primary key (tabela_preco_id, forma_pagamento_id)
);

alter table pedidos add column if not exists forma_pagamento_erp_id uuid references formas_pagamento_erp(id);
alter table orcamentos add column if not exists forma_pagamento_erp_id uuid references formas_pagamento_erp(id);

insert into schema_migrations (versao) values ('036') on conflict do nothing;
