-- =====================================================================
-- Fluxo Commerce — Banco do TENANT (fluxo_t_<slug>)
-- Migração 001 — schema inicial
-- Um banco por distribuidora. Nenhuma query cruza bancos de tenants.
-- Convenções: uuid PK, timestamptz, numeric(12,2) para dinheiro.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create table if not exists schema_migrations (
  versao      text primary key,
  aplicada_em timestamptz not null default now()
);

-- ============================== IDENTIDADE ===========================

create table if not exists clientes (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('CPF','CNPJ')),
  documento       text not null unique,
  razao_social    text,
  nome_fantasia   text not null,
  email           text not null unique,
  telefone        text,
  status          text not null default 'pendente' check (status in ('pendente','aprovado','bloqueado')),
  erp_cliente_id  text,
  tabela_preco_id uuid,
  criado_em       timestamptz not null default now()
);

create table if not exists cliente_enderecos (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references clientes(id),
  apelido     text,
  cep         text not null,
  logradouro  text not null,
  numero      text not null,
  complemento text,
  bairro      text not null,
  cidade      text not null,
  uf          char(2) not null,
  padrao      boolean not null default false
);

create table if not exists cliente_credenciais (
  cliente_id      uuid primary key references clientes(id),
  senha_hash      text not null,               -- argon2id
  ultimo_login_em timestamptz
);

create table if not exists usuarios_admin (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  email      text not null unique,
  senha_hash text not null,
  papel      text not null default 'operador' check (papel in ('admin','operador')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id          uuid primary key default gen_random_uuid(),
  sujeito_id  uuid not null,                   -- cliente_id ou usuario_admin_id
  sujeito     text not null check (sujeito in ('cliente','admin')),
  token_hash  text not null unique,
  expira_em   timestamptz not null,
  revogado_em timestamptz
);

-- ============================== CATÁLOGO =============================

create table if not exists categorias (
  id               uuid primary key default gen_random_uuid(),
  pai_id           uuid references categorias(id),
  nome             text not null,
  slug             text not null unique,
  imagem_url       text,
  ordem            int not null default 0,
  ativo            boolean not null default true,
  erp_categoria_id text
);

create table if not exists marcas (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  logo_url     text,
  ativo        boolean not null default true,
  erp_marca_id text
);

create table if not exists produtos (
  id                uuid primary key default gen_random_uuid(),
  sku               text not null unique,
  ean               text,
  nome              text not null,
  descricao         text,
  marca_id          uuid references marcas(id),
  categoria_id      uuid references categorias(id),
  unidade_venda     text not null default 'UN' check (unidade_venda in ('UN','CX','FD','PC','KG')),
  qtd_por_embalagem numeric(10,3) not null default 1,
  qtd_minima        numeric(10,3) not null default 1,
  peso_kg           numeric(10,3),
  ativo             boolean not null default true,
  erp_produto_id    text unique,
  atualizado_erp_em timestamptz,
  criado_em         timestamptz not null default now()
);

-- unaccent() é STABLE; índices exigem IMMUTABLE — wrapper com dicionário explícito resolve
create or replace function imm_unaccent(text) returns text
  language sql immutable parallel safe strict
  as $$ select public.unaccent('public.unaccent', $1) $$;

create index if not exists idx_produtos_busca
  on produtos using gin (to_tsvector('portuguese', imm_unaccent(nome || ' ' || coalesce(descricao,''))));
create index if not exists idx_produtos_categoria on produtos (categoria_id) where ativo;
create index if not exists idx_produtos_marca on produtos (marca_id) where ativo;

create table if not exists produto_imagens (
  id         uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id),
  url        text not null,
  ordem      int not null default 0,
  origem     text not null default 'retaguarda' check (origem in ('erp','retaguarda'))
);

create table if not exists tabelas_preco (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  padrao        boolean not null default false,
  erp_tabela_id text
);

create table if not exists precos (
  produto_id      uuid not null references produtos(id),
  tabela_preco_id uuid not null references tabelas_preco(id),
  preco           numeric(12,2) not null check (preco >= 0),
  atualizado_em   timestamptz not null default now(),
  primary key (produto_id, tabela_preco_id)
);

create table if not exists estoques (
  produto_id    uuid primary key references produtos(id),
  quantidade    numeric(12,3) not null default 0,
  atualizado_em timestamptz not null default now()
);

create table if not exists promocoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  inicio_em timestamptz not null,
  fim_em    timestamptz not null,
  ativo     boolean not null default true,
  check (fim_em > inicio_em)
);

create table if not exists promocao_produtos (
  promocao_id        uuid not null references promocoes(id),
  produto_id         uuid not null references produtos(id),
  preco_promocional  numeric(12,2) not null check (preco_promocional >= 0),
  primary key (promocao_id, produto_id)
);

create table if not exists banners (
  id           uuid primary key default gen_random_uuid(),
  titulo       text,
  imagem_url   text not null,
  destino_tipo text check (destino_tipo in ('produto','categoria','promocao','url')),
  destino_id   text,
  ordem        int not null default 0,
  inicio_em    timestamptz,
  fim_em       timestamptz,
  ativo        boolean not null default true
);

-- ============================== VENDAS ===============================

create table if not exists carrinhos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null unique references clientes(id),
  atualizado_em timestamptz not null default now()
);

create table if not exists carrinho_itens (
  carrinho_id         uuid not null references carrinhos(id),
  produto_id          uuid not null references produtos(id),
  quantidade          numeric(10,3) not null check (quantidade > 0),
  preco_unit_snapshot numeric(12,2) not null,
  primary key (carrinho_id, produto_id)
);

create sequence if not exists pedidos_numero_seq;

create table if not exists pedidos (
  id                     uuid primary key default gen_random_uuid(),
  numero                 bigint not null default nextval('pedidos_numero_seq') unique,
  cliente_id             uuid not null references clientes(id),
  endereco_snapshot_json jsonb not null,
  status                 text not null default 'RECEBIDO' check (status in
    ('RECEBIDO','ENVIADO_ERP','FATURADO','EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO')),
  forma_pagamento        text not null check (forma_pagamento in ('boleto','pix')),
  subtotal               numeric(12,2) not null,
  desconto               numeric(12,2) not null default 0,
  total                  numeric(12,2) not null,
  observacoes            text,
  erp_pedido_id          text unique,
  criado_em              timestamptz not null default now()
);

create index if not exists idx_pedidos_cliente on pedidos (cliente_id, criado_em desc);
create index if not exists idx_pedidos_status on pedidos (status);

create table if not exists pedido_itens (
  pedido_id          uuid not null references pedidos(id),
  produto_id         uuid not null references produtos(id),
  descricao_snapshot text not null,
  quantidade         numeric(10,3) not null,
  preco_unit         numeric(12,2) not null,
  total              numeric(12,2) not null,
  primary key (pedido_id, produto_id)
);

create table if not exists pedido_eventos (
  id        uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references pedidos(id),
  status    text not null,
  detalhe   text,
  origem    text not null default 'app' check (origem in ('app','erp','retaguarda','sistema')),
  criado_em timestamptz not null default now()
);

create table if not exists pedido_cobrancas (
  pedido_id       uuid primary key references pedidos(id),
  tipo            text not null check (tipo in ('boleto','pix')),
  linha_digitavel text,
  pix_copia_cola  text,
  pdf_url         text,
  valor           numeric(12,2) not null,
  vencimento      date,
  pago_em         timestamptz
);

create table if not exists pedido_notas (
  pedido_id    uuid primary key references pedidos(id),
  numero_nf    text not null,
  chave_acesso text,
  xml_url      text,
  pdf_url      text,
  emitida_em   timestamptz
);

-- ==================== COMUNICAÇÃO E INTEGRAÇÃO =======================

create table if not exists dispositivos (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references clientes(id),
  fcm_token     text not null unique,
  plataforma    text check (plataforma in ('android','ios')),
  atualizado_em timestamptz not null default now()
);

create table if not exists notificacoes (
  id         uuid primary key default gen_random_uuid(),
  titulo     text not null,
  corpo      text not null,
  destino    text not null default 'todos' check (destino in ('todos','segmento','cliente')),
  filtro_json jsonb,
  enviada_em timestamptz
);

create table if not exists notificacao_entregas (
  notificacao_id uuid not null references notificacoes(id),
  cliente_id     uuid not null references clientes(id),
  lida_em        timestamptz,
  primary key (notificacao_id, cliente_id)
);

create table if not exists integracao_config (
  id                   uuid primary key default gen_random_uuid(),
  adaptador            text not null,          -- ex.: 'dlinks'
  transporte           text not null check (transporte in ('api','banco','arquivo','mock')),
  credenciais_cifradas text,
  agenda_sync_json     jsonb not null default '{"precos_estoque_min":15,"produtos_clientes_min":60}',
  ativo                boolean not null default true
);

create table if not exists integracao_logs (
  id              uuid primary key default gen_random_uuid(),
  operacao        text not null,               -- ex.: 'enviarPedido', 'syncEstoque'
  direcao         text not null check (direcao in ('fluxo_para_erp','erp_para_fluxo')),
  request_resumo  text,
  response_resumo text,
  sucesso         boolean not null,
  duracao_ms      int,
  criado_em       timestamptz not null default now()
);

create index if not exists idx_integracao_logs_data on integracao_logs (criado_em desc);

create table if not exists sync_outbox (
  id            uuid primary key default gen_random_uuid(),
  agregado      text not null,                 -- ex.: 'pedido'
  agregado_id   uuid not null,
  evento        text not null,                 -- ex.: 'pedido_criado'
  payload_json  jsonb not null,
  tentativas    int not null default 0,
  processado_em timestamptz,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_outbox_pendentes on sync_outbox (criado_em) where processado_em is null;

create table if not exists auditoria (
  id               uuid primary key default gen_random_uuid(),
  usuario_admin_id uuid references usuarios_admin(id),
  acao             text not null,
  entidade         text not null,
  entidade_id      text,
  dados_json       jsonb,
  criado_em        timestamptz not null default now()
);

create table if not exists configuracoes (
  chave      text primary key,
  valor_json jsonb not null
);

-- Configurações padrão
insert into configuracoes (chave, valor_json) values
  ('pedido_minimo',        '{"tipo":"valor","valor":0}'),
  ('formas_pagamento',     '["pix","boleto"]'),
  ('aprovacao_cadastro',   'true'),
  ('horario_atendimento',  '{"seg_sex":"08:00-18:00","sab":"08:00-12:00"}')
on conflict do nothing;

insert into schema_migrations (versao) values ('001') on conflict do nothing;
