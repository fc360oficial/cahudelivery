-- Indica CAHU (benchmark Praso, 04/08/2026): programa de indicação. Sem
-- tabela nova — codigo_indicacao é o código do próprio cliente pra indicar
-- outros; indicado_por_cliente_id é preenchido uma vez, no cadastro do
-- indicado; indicacao_creditada_em funciona como lock (garante que o
-- crédito de R$100 dispara uma única vez, na transição do pedido do
-- indicado pra FATURADO — ver OutboxWorker.sincronizarStatus).
alter table clientes add column if not exists codigo_indicacao text unique;
alter table clientes add column if not exists indicado_por_cliente_id uuid references clientes(id);
alter table clientes add column if not exists indicacao_creditada_em timestamptz;

-- Backfill: clientes cadastrados antes desta migração não têm código —
-- gera um código de 6 caracteres derivado do próprio id (determinístico o
-- suficiente pra não colidir, não precisa de retry aqui como no cadastro).
update clientes set codigo_indicacao = upper(substring(md5(random()::text || id::text) from 1 for 6))
where codigo_indicacao is null;

alter table clientes alter column codigo_indicacao set not null;

insert into schema_migrations (versao) values ('013') on conflict do nothing;
