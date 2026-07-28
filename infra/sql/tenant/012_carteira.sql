-- Carteira (benchmark Praso, 28/07/2026): saldo alimentado manualmente pela
-- retaguarda (devolução, ajuste), usável parcialmente no checkout. Saldo é
-- sempre sum(valor) dos movimentos — sem coluna de saldo redundante.
create table if not exists carteira_movimentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  valor numeric not null,
  motivo text not null,
  pedido_id uuid references pedidos(id),
  criado_por uuid references usuarios_admin(id),
  criado_em timestamptz not null default now()
);

alter table pedidos add column if not exists valor_saldo_usado numeric not null default 0;

insert into schema_migrations (versao) values ('012') on conflict do nothing;