-- infra/sql/tenant/043_entregas_cargas.sql
-- Fluxo Entregas, fase 1, etapa 4 (17/11/2026): montagem de carga.
--  * cargas: um caminhão num dia. Nasce 'rascunho' (sugerida pelo sistema ou montada à mão), o gerente do CD
--    autoriza ('autorizada') e só então ela aparece no aplicativo do motorista; 'em_rota' e 'encerrada' vêm
--    com o aplicativo. Um caminhão só tem uma carga viva por dia.
--  * carga_entregas: as notas que vão na carga, na ordem das paradas. Guarda uma cópia dos dados da entrega
--    (cliente, endereço, nota, volumes, peso) como estavam na hora: é o que vai para o romaneio.
--    Uma nota só pode estar viva em UMA carga.
-- Não altera nenhuma tabela existente. Repetível: pode rodar mais de uma vez.

create sequence if not exists cargas_numero_seq;

create table if not exists cargas (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint not null default nextval('cargas_numero_seq') unique,
  data_entrega   date not null,
  caminhao_id    uuid references caminhoes(id),
  motorista_id   uuid references motoristas(id),
  status         text not null default 'rascunho'
                 check (status in ('rascunho','autorizada','em_rota','encerrada','cancelada')),
  sugerida       boolean not null default false,   -- true = nasceu da sugestão do sistema
  criada_por     uuid,
  criada_em      timestamptz not null default now(),
  autorizada_por uuid,
  autorizada_em  timestamptz,
  saida_em       timestamptz,
  retorno_em     timestamptz,
  atualizada_em  timestamptz not null default now()
);

create index if not exists cargas_data on cargas (data_entrega);
create unique index if not exists cargas_caminhao_dia on cargas (caminhao_id, data_entrega)
  where caminhao_id is not null and status in ('rascunho','autorizada','em_rota');

create table if not exists carga_entregas (
  id              uuid primary key default gen_random_uuid(),
  carga_id        uuid not null references cargas(id) on delete cascade,
  ordem           int not null,
  pedido_id       uuid references pedidos(id),
  nota_entrega_id uuid references notas_entrega(id),
  dados_json      jsonb not null,                  -- cópia da entrega na hora em que entrou na carga
  volumes         numeric(12,3) not null default 0,
  peso_kg         numeric(12,3),                   -- nulo = nenhum item com peso conhecido
  itens_sem_peso  int not null default 0,
  status          text not null default 'pendente' check (status in ('pendente','entregue','nao_entregue')),
  viva            boolean not null default true,   -- false = saiu da carga (voltou para o CD)
  criada_em       timestamptz not null default now(),
  constraint carga_entregas_uma_origem check ((pedido_id is null) <> (nota_entrega_id is null))
);

create index if not exists carga_entregas_carga on carga_entregas (carga_id, ordem);
create unique index if not exists carga_entregas_pedido_vivo on carga_entregas (pedido_id) where viva and pedido_id is not null;
create unique index if not exists carga_entregas_nota_viva on carga_entregas (nota_entrega_id) where viva and nota_entrega_id is not null;

insert into schema_migrations (versao) values ('043') on conflict do nothing;
