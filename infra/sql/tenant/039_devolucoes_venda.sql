-- infra/sql/tenant/039_devolucoes_venda.sql
-- Fluxo Vendas (12/11/2026): devoluções de venda enviadas pelo ERP.
-- Quando o cliente devolve parte (ou tudo) do que foi faturado, o ERP dá entrada na nota de devolução
-- referenciando a nota de venda e manda a devolução (POST /v1/integracoes/dlinks/devolucoes).
-- O valor devolvido é abatido da venda do vendedor NO MÊS EM QUE A DEVOLUÇÃO ENTROU (devolvido_em),
-- nunca no mês da venda: mês fechado não muda. O vendedor recebe só sobre o que ficou com o cliente.
-- Reenviar a mesma nota (numero_nota + serie) corrige o valor; cancelada = true tira a devolução da conta.
-- Repetível: pode rodar mais de uma vez.

create table if not exists devolucoes_venda (
  id            uuid primary key default gen_random_uuid(),
  numero_nota   text not null,
  serie         text not null default '',
  vendedor_id   uuid not null references vendedores(id) on delete cascade,
  pedido_id     uuid references pedidos(id) on delete set null,
  cliente_id    uuid references clientes(id) on delete set null,
  nota_venda    text,
  valor         numeric(14,2) not null check (valor >= 0),
  devolvido_em  timestamptz not null,
  cancelada     boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (numero_nota, serie)
);

create index if not exists devolucoes_venda_vendedor_data on devolucoes_venda (vendedor_id, devolvido_em);

insert into schema_migrations (versao) values ('039') on conflict do nothing;
