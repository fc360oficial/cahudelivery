-- Favoritos (benchmark Praso, 24/07/2026): cliente favorita produto, salvo no
-- servidor (não local) para sincronizar entre dispositivos.
create table if not exists favoritos (
  cliente_id uuid not null references clientes(id),
  produto_id uuid not null references produtos(id),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

insert into schema_migrations (versao) values ('010') on conflict do nothing;