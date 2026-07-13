-- 002_carrinho_anonimo.sql — carrinho de visitante identificado por dispositivo.
-- Idempotente. Aplicar em cada banco de tenant (dev: fluxo_t_cahu).

alter table carrinhos alter column cliente_id drop not null;
alter table carrinhos add column if not exists device_id text;

-- o unique inline original vira índice parcial (necessário p/ on conflict)
alter table carrinhos drop constraint if exists carrinhos_cliente_id_key;
create unique index if not exists carrinhos_cliente_uk on carrinhos (cliente_id) where cliente_id is not null;
create unique index if not exists carrinhos_device_uk  on carrinhos (device_id)  where device_id  is not null;

alter table carrinhos drop constraint if exists carrinhos_dono_ck;
alter table carrinhos add constraint carrinhos_dono_ck
  check ((cliente_id is null) <> (device_id is null));
