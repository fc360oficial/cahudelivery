-- infra/sql/tenant/034_fluxo_vendas.sql
-- Fluxo Vendas, fase 1 (09/11/2026): vendedor externo tira pedido e orçamento pelo app.
--  * vendedores e cliente_vendedor (carteira) chegam do ERP;
--  * tabela_preco_condicoes diz quais condições de pagamento cada tabela aceita;
--  * orcamentos fica FORA de pedidos: o ERP importa tudo que está em pedidos;
--  * pedidos ganha o vendedor, a tabela e a condição usadas e o id gerado no aparelho
--    (reenvio do mesmo pedido não duplica);
--  * AGUARDANDO_VENDEDOR = pedido retido por divergência de preço, estoque ou crédito.

create table if not exists vendedores (
  id              uuid primary key default gen_random_uuid(),
  erp_vendedor_id text not null unique,
  nome            text not null,
  filial          text,
  login           text unique,                 -- definido na retaguarda; nulo = ainda sem acesso
  senha_hash      text,                        -- argon2id
  ativo           boolean not null default true,
  acesso_bloqueado boolean not null default false, -- bloqueio feito na retaguarda; o ERP não mexe nele
  ultima_sync_em  timestamptz,
  app_versao      text,
  criado_em       timestamptz not null default now()
);
alter table vendedores add column if not exists acesso_bloqueado boolean not null default false;

create table if not exists cliente_vendedor (
  cliente_id  uuid not null references clientes(id),
  vendedor_id uuid not null references vendedores(id),
  primary key (cliente_id, vendedor_id)
);
create index if not exists idx_cliente_vendedor_vendedor on cliente_vendedor (vendedor_id);

create table if not exists tabela_preco_condicoes (
  tabela_preco_id       uuid not null references tabelas_preco(id),
  condicao_pagamento_id uuid not null references condicoes_pagamento_erp(id),
  primary key (tabela_preco_id, condicao_pagamento_id)
);

create table if not exists orcamentos (
  id                    uuid primary key,      -- gerado no aparelho
  vendedor_id           uuid not null references vendedores(id),
  cliente_id            uuid not null references clientes(id),
  tabela_preco_id       uuid not null references tabelas_preco(id),
  condicao_pagamento_id uuid references condicoes_pagamento_erp(id),
  tipo_entrega          text not null default 'entrega' check (tipo_entrega in ('entrega','retirada')),
  observacoes           text,
  total                 numeric(12,2) not null,
  status                text not null default 'aberto' check (status in ('aberto','convertido','cancelado')),
  pedido_id             uuid references pedidos(id),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists idx_orcamentos_vendedor on orcamentos (vendedor_id, status);

create table if not exists orcamento_itens (
  orcamento_id uuid not null references orcamentos(id) on delete cascade,
  produto_id   uuid not null references produtos(id),
  quantidade   numeric(10,3) not null,
  preco_unit   numeric(12,2) not null,
  primary key (orcamento_id, produto_id)
);

alter table pedidos add column if not exists vendedor_id uuid references vendedores(id);
alter table pedidos add column if not exists origem text not null default 'app_cliente';
alter table pedidos drop constraint if exists pedidos_origem_check;
alter table pedidos add constraint pedidos_origem_check check (origem in ('app_cliente','vendedor'));
alter table pedidos add column if not exists tabela_preco_id uuid references tabelas_preco(id);
alter table pedidos add column if not exists condicao_pagamento_id uuid references condicoes_pagamento_erp(id);
alter table pedidos add column if not exists id_dispositivo uuid;
alter table pedidos add column if not exists retencao_json jsonb;
alter table pedidos add column if not exists criado_no_aparelho_em timestamptz;
create unique index if not exists uq_pedidos_id_dispositivo on pedidos (id_dispositivo) where id_dispositivo is not null;
create index if not exists idx_pedidos_vendedor on pedidos (vendedor_id, criado_em desc) where vendedor_id is not null;

alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('AGUARDANDO_PAGAMENTO','AGUARDANDO_VENDEDOR','RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO','FATURADO',
                    'EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO'));

alter table refresh_tokens drop constraint if exists refresh_tokens_sujeito_check;
alter table refresh_tokens add constraint refresh_tokens_sujeito_check
  check (sujeito in ('cliente','admin','vendedor'));

insert into schema_migrations (versao) values ('034') on conflict do nothing;
