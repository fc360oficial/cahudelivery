-- Site de vendas (13/11/2026): pedido fechado pelo site grava pedidos.origem = 'site'.
-- Só amplia o check criado na 034; nenhum dado muda (os pedidos atuais seguem app_cliente/vendedor).
-- APLICAR ANTES de o site mandar X-Canal: site no POST /v1/pedidos (sem ela o insert com 'site' é recusado).
-- Repetível: pode rodar mais de uma vez.

-- Se a tabela estiver ocupada por uma consulta longa, desiste em 5 s em vez de enfileirar
-- todo mundo atrás deste alter. Nesse caso é só rodar de novo.
set lock_timeout = '5s';

alter table pedidos drop constraint if exists pedidos_origem_check;
-- "not valid" entra sem varrer a tabela (trava curta); a validação depois não bloqueia escrita.
alter table pedidos add constraint pedidos_origem_check check (origem in ('app_cliente','vendedor','site')) not valid;
alter table pedidos validate constraint pedidos_origem_check;

reset lock_timeout;

insert into schema_migrations (versao) values ('039') on conflict do nothing;
