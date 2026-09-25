-- infra/sql/tenant/030_pagamentos.sql
-- Pagamento online no checkout (PIX Itaú agora, cartão e.Rede depois).
-- Um pedido pago online nasce em AGUARDANDO_PAGAMENTO e só vira RECEBIDO
-- (visível pro Dlinks) quando o provedor confirma.

alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('AGUARDANDO_PAGAMENTO','RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO','FATURADO',
                    'EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO'));

create table if not exists pagamentos (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id),
  provedor      text not null,                       -- itau_pix | rede_cartao | mock
  metodo        text not null check (metodo in ('pix','cartao')),
  status        text not null default 'pendente'
                check (status in ('pendente','pago','expirado','cancelado','falhou')),
  valor         numeric(12,2) not null,
  valor_pago    numeric(12,2),
  provedor_ref  text,                                -- txid do Itaú
  copia_cola    text,                                -- BR Code (PIX copia e cola)
  expira_em     timestamptz,
  pago_em       timestamptz,
  payload_json  jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_pagamentos_pedido on pagamentos (pedido_id);
create unique index if not exists uq_pagamentos_provedor_ref on pagamentos (provedor, provedor_ref) where provedor_ref is not null;
-- Só um pagamento vivo (pendente ou pago) por pedido.
create unique index if not exists uq_pagamentos_pedido_vivo on pagamentos (pedido_id) where status in ('pendente','pago');
-- Fila do worker: pendentes mais antigos primeiro.
create index if not exists idx_pagamentos_pendentes on pagamentos (expira_em) where status = 'pendente';

-- 027 criou a tabela pensando só na MaxiPago; vira fila genérica.
alter table pagamento_webhooks alter column origem drop default;
alter table pagamento_webhooks alter column origem set default 'desconhecida';

insert into schema_migrations (versao) values ('030') on conflict do nothing;
