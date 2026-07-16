-- Adiciona o status 'excluido' — usado quando a retaguarda exclui um cliente
-- que já tem pedidos (não dá pra apagar a linha, senão perde o histórico de
-- venda/nota fiscal). Cliente sem nenhum pedido é removido de verdade.
alter table clientes drop constraint if exists clientes_status_check;
alter table clientes add constraint clientes_status_check
  check (status in ('pendente','aprovado','bloqueado','excluido'));

insert into schema_migrations (versao) values ('004') on conflict do nothing;
