-- Receptor de callback assíncrono do gateway de pagamentos (MaxiPago/Rede, 22/09/2026).
-- Nesta fase só guardamos o payload cru: a chave de integração e.Rede ainda não foi
-- liberada pela Rede, então o formato real do callback é desconhecido. Quando chegar,
-- lemos o que já foi gravado aqui para escrever o processamento em cima do dado real.
create table if not exists pagamento_webhooks (
  id           uuid primary key default gen_random_uuid(),
  origem       text not null default 'maxipago',
  recebido_em  timestamptz not null default now(),
  content_type text,
  corpo_bruto  text not null,
  ip_origem    text,
  processado   boolean not null default false,
  erro         text
);

-- Fila do processamento futuro: buscar o que ainda não foi tratado, mais antigo primeiro.
create index if not exists idx_pagamento_webhooks_pendentes
  on pagamento_webhooks (recebido_em)
  where processado = false;

insert into schema_migrations (versao) values ('027') on conflict do nothing;
