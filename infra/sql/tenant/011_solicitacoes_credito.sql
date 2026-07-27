-- Solicitações de análise de crédito pra boleto a prazo (benchmark Praso, 27/07/2026).
-- Sem cálculo automático de limite — fila manual até a Fase 4 (Dlinks) trazer dado real.
create table if not exists solicitacoes_credito (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  status text not null default 'pendente' check (status in ('pendente','atendida')),
  solicitado_em timestamptz not null default now(),
  atendido_em timestamptz,
  atendido_por uuid references usuarios_admin(id)
);

-- Garante no máximo 1 solicitação pendente por cliente, no próprio banco.
create unique index if not exists solicitacoes_credito_pendente_unica
  on solicitacoes_credito (cliente_id)
  where status = 'pendente';

insert into schema_migrations (versao) values ('011') on conflict do nothing;