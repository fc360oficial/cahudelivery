-- =====================================================================
-- Fluxo Commerce — Banco de CONTROLE (fluxo_control)
-- Migração 001 — schema inicial
-- Um único banco da plataforma. Nunca contém dados de clientes finais.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  versao        text primary key,
  aplicada_em   timestamptz not null default now()
);

create table if not exists tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,            -- ex.: 'cahu'
  nome_fantasia text not null,                   -- ex.: 'CAHU Distribuidora'
  app_nome      text not null,                   -- ex.: 'CAHU Delivery'
  status        text not null default 'ativo' check (status in ('ativo','suspenso','encerrado')),
  criado_em     timestamptz not null default now()
);

create table if not exists tenant_bancos (
  tenant_id     uuid primary key references tenants(id),
  host          text not null default 'localhost',
  porta         int  not null default 5432,
  banco         text not null,                   -- ex.: 'fluxo_t_cahu'
  usuario       text not null,
  senha_cifrada text not null,                   -- AES-256-GCM (chave no vault/env)
  versao_schema text,
  atualizado_em timestamptz not null default now()
);

create table if not exists tenant_temas (
  tenant_id       uuid primary key references tenants(id),
  cor_primaria    text not null default '#1E88E5',
  cor_secundaria  text not null default '#0D47A1',
  logo_url        text,
  splash_url      text,
  config_json     jsonb not null default '{}',
  atualizado_em   timestamptz not null default now()
);

create table if not exists tenant_features (
  tenant_id   uuid not null references tenants(id),
  chave       text not null,                     -- ex.: 'catalogo_publico'
  habilitado  boolean not null default false,
  primary key (tenant_id, chave)
);

create table if not exists plataforma_usuarios (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  email       text not null unique,
  senha_hash  text not null,
  papel       text not null default 'operador' check (papel in ('admin','operador')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

insert into schema_migrations (versao) values ('001') on conflict do nothing;
