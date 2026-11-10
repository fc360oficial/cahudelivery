-- infra/sql/tenant/037_tabela_tipo_entrega.sql
-- Fluxo Vendas, retaguarda (10/11/2026): a tabela de preço define se o pedido é de ENTREGA ou de RETIRADA.
--  * tabelas_preco.tipo_entrega ('entrega' | 'retirada'), padrão 'entrega';
--  * valor inicial: tabelas com RETIRA no nome viram 'retirada' (ex.: "TABELA RETIRADA PIX/CARTÃO/BOLETO 7 DIAS").
-- Repetível: pode rodar mais de uma vez. O ajuste inicial roda só quando a coluna é criada neste mesmo run;
-- numa segunda execução a coluna já existe e o bloco não faz nada, então um valor que o administrador
-- mudou depois pela tela Tabelas nunca é sobrescrito.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = current_schema() and table_name = 'tabelas_preco' and column_name = 'tipo_entrega'
  ) then
    alter table tabelas_preco add column tipo_entrega text not null default 'entrega';
    update tabelas_preco set tipo_entrega = 'retirada' where nome ilike '%RETIRA%';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'tabelas_preco_tipo_entrega_check' and conrelid = 'tabelas_preco'::regclass
  ) then
    alter table tabelas_preco add constraint tabelas_preco_tipo_entrega_check check (tipo_entrega in ('entrega', 'retirada'));
  end if;
end $$;

insert into schema_migrations (versao) values ('037') on conflict do nothing;
