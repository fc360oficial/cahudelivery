-- Cliente pode optar por retirar na distribuidora em vez de receber entrega.
-- Endereço deixa de ser obrigatório quando o pedido é retirada.
alter table pedidos add column if not exists tipo_entrega text not null default 'entrega';
alter table pedidos drop constraint if exists pedidos_tipo_entrega_check;
alter table pedidos add constraint pedidos_tipo_entrega_check check (tipo_entrega in ('entrega','retirada'));

alter table pedidos alter column endereco_snapshot_json drop not null;
alter table pedidos drop constraint if exists pedidos_endereco_ou_retirada_check;
alter table pedidos add constraint pedidos_endereco_ou_retirada_check
  check (tipo_entrega = 'retirada' or endereco_snapshot_json is not null);

insert into schema_migrations (versao) values ('006') on conflict do nothing;
