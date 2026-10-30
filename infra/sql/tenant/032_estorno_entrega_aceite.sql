-- infra/sql/tenant/032_estorno_entrega_aceite.sql
-- Proteção contra chargeback e estorno do cartão (30/10/2026):
--  * pagamentos ganha o tid da e.Rede, o resultado do 3DS e os status de estorno;
--  * pagamento_estornos guarda cada devolução: estorno do cartão na Rede, PIX virando
--    crédito na carteira (padrão) e PIX devolvido em dinheiro quando o cliente pede;
--  * pedido_entregas é o comprovante de entrega (recebedor, documento, foto do canhoto);
--  * pedidos.aceite_json registra o aceite da política no checkout (IP, aparelho, versão do texto).

alter table pagamentos drop constraint if exists pagamentos_status_check;
alter table pagamentos add constraint pagamentos_status_check
  check (status in ('pendente','autorizado','pago','expirado','cancelado','falhou','estorno_solicitado','estornado','creditado'));

alter table pagamentos add column if not exists provedor_tid text;        -- tid da e.Rede (necessário pro estorno)
alter table pagamentos add column if not exists autenticacao_3ds text;    -- returnCode do 3DS (200 = autenticado)

-- Pré-autorização do cartão: 'posterior' = só reserva no checkout ('autorizado') e
-- cobra o valor da NF-e no faturamento. 'automatica' = cobra tudo na hora (como sempre foi).
alter table pagamentos add column if not exists captura text not null default 'automatica';
alter table pagamentos drop constraint if exists pagamentos_captura_check;
alter table pagamentos add constraint pagamentos_captura_check check (captura in ('automatica','posterior'));
alter table pagamentos add column if not exists autorizado_em timestamptz;
alter table pagamentos add column if not exists captura_erro text;         -- última falha ao cobrar a reserva
create index if not exists idx_pagamentos_autorizados on pagamentos (autorizado_em) where status = 'autorizado';

-- Só um pagamento vivo por pedido: estorno em andamento/concluído continua "ocupando" o pedido.
drop index if exists uq_pagamentos_pedido_vivo;
create unique index if not exists uq_pagamentos_pedido_vivo on pagamentos (pedido_id)
  where status in ('pendente','autorizado','pago','estorno_solicitado','estornado','creditado');

create table if not exists pagamento_estornos (
  id            uuid primary key default gen_random_uuid(),
  pagamento_id  uuid not null references pagamentos(id),
  valor         numeric(12,2) not null,
  -- cartao = estorno na Rede; carteira = PIX virou crédito no app; pix = devolvido por PIX (cliente pediu o dinheiro)
  destino       text not null default 'cartao' check (destino in ('cartao','carteira','pix')),
  status        text not null check (status in ('solicitado','concluido','falhou')),
  refund_id     text,
  codigo        text,                  -- returnCode da Rede (359 concluído, 360 solicitado)
  mensagem      text,
  tentar_de_novo boolean not null default false, -- falha passageira (Rede fora/368/370): o worker refaz
  motivo        text not null,
  origem        text not null check (origem in ('erp','retaguarda','sistema')),
  usuario_admin_id uuid,
  payload_json  jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_pagamento_estornos_pagamento on pagamento_estornos (pagamento_id);
create index if not exists idx_pagamento_estornos_solicitados on pagamento_estornos (criado_em) where status = 'solicitado';

create table if not exists pedido_entregas (
  pedido_id            uuid primary key references pedidos(id),
  recebedor_nome       text not null,
  recebedor_documento  text,
  foto_canhoto         text,           -- nome do arquivo em uploads-privado/entregas (nunca público)
  foto_entrega         text,
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  observacao           text,
  entregue_em          timestamptz not null,
  registrado_por       uuid,
  criado_em            timestamptz not null default now()
);

alter table pedidos add column if not exists aceite_json jsonb;

insert into schema_migrations (versao) values ('032') on conflict do nothing;
