-- infra/sql/tenant/044_entregas_motorista.sql
-- Fluxo Entregas, fase 1, etapa 5 (17/11/2026): o que o aplicativo do motorista registra.
--  * carga_entregas ganha a chegada (hora e GPS do toque em "Cheguei", distância do endereço), a conclusão
--    (entregue ou não entregue, hora e GPS), quem recebeu e as fotos (assinatura no romaneio, mercadoria, local);
--  * carga_ocorrencias: avaria, falta, troca ou item recusado, com foto. O gerente do CD resolve na retaguarda
--    (nota, crédito e estoque continuam pelo Dlinks). O id vem do celular: reenviar sem sinal não duplica;
--  * motorista_posicoes: a posição do celular durante a rota (só com a carga em rota);
--  * notas_entrega aceita o status ENTREGUE (nota do televendas entregue pelo motorista).
-- Fotos ficam em uploads-privado (fora do público), como o comprovante do Delivery.
-- Não altera dados existentes. Repetível: pode rodar mais de uma vez.

alter table carga_entregas add column if not exists chegada_em          timestamptz;
alter table carga_entregas add column if not exists chegada_lat         numeric(9,6);
alter table carga_entregas add column if not exists chegada_lng         numeric(9,6);
alter table carga_entregas add column if not exists chegada_distancia_m int;        -- do ponto do cadastro; nulo = cliente sem ponto
alter table carga_entregas add column if not exists concluida_em        timestamptz;
alter table carga_entregas add column if not exists concluida_lat       numeric(9,6);
alter table carga_entregas add column if not exists concluida_lng       numeric(9,6);
alter table carga_entregas add column if not exists recebedor_nome      text;
alter table carga_entregas add column if not exists recebedor_documento text;
alter table carga_entregas add column if not exists foto_assinatura     text;        -- linha assinada no romaneio (ou canhoto)
alter table carga_entregas add column if not exists foto_mercadoria     text;
alter table carga_entregas add column if not exists foto_local          text;        -- não entregue
alter table carga_entregas add column if not exists motivo_nao_entrega  text
  check (motivo_nao_entrega is null or motivo_nao_entrega in ('cliente_fechado','sem_recebedor','recusou','endereco_nao_encontrado','outro'));
alter table carga_entregas add column if not exists observacao          text;

create table if not exists carga_ocorrencias (
  id                uuid primary key,              -- gerado no celular
  carga_entrega_id  uuid not null references carga_entregas(id) on delete cascade,
  tipo              text not null check (tipo in ('avaria','falta','troca','recusa_item')),
  produto_codigo    text,
  produto_descricao text,
  quantidade        numeric(12,3),
  foto              text,
  observacao        text,
  registrada_em     timestamptz not null,          -- hora do celular
  recebida_em       timestamptz not null default now(),
  resolvida_em      timestamptz,
  resolvida_por     uuid,
  resolucao         text                           -- o que foi combinado com o cliente
);
create index if not exists carga_ocorrencias_entrega on carga_ocorrencias (carga_entrega_id);
create index if not exists carga_ocorrencias_abertas on carga_ocorrencias (registrada_em) where resolvida_em is null;

create table if not exists motorista_posicoes (
  id            bigserial primary key,
  motorista_id  uuid not null references motoristas(id),
  carga_id      uuid references cargas(id) on delete set null,
  lat           numeric(9,6) not null,
  lng           numeric(9,6) not null,
  precisao_m    int,
  registrada_em timestamptz not null,
  recebida_em   timestamptz not null default now(),
  unique (motorista_id, registrada_em)             -- o reenvio do mesmo ponto não duplica
);
create index if not exists motorista_posicoes_carga on motorista_posicoes (carga_id, registrada_em desc);

set lock_timeout = '5s';
alter table notas_entrega drop constraint if exists notas_entrega_status_check;
alter table notas_entrega add constraint notas_entrega_status_check check (status in ('FATURADO','CANCELADO','ENTREGUE'));
reset lock_timeout;

insert into schema_migrations (versao) values ('044') on conflict do nothing;
