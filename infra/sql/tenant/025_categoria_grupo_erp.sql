-- 025: grupos do ERP deixam de virar categoria. A tabela guarda "grupo do Dlinks → categoria
-- da retaguarda"; o sync de produtos usa esse mapa e o sync de grupos só registra grupos novos
-- (sem categoria, até alguém mapear). Categorias passam a ser 100% gerenciadas na retaguarda.
create table if not exists categoria_grupo_erp (
  erp_categoria_id text primary key,
  nome_erp         text,
  categoria_id     uuid references categorias(id) on delete set null,
  atualizado_em    timestamptz not null default now()
);

-- Carga inicial: cada categoria que veio do ERP mapeia para si mesma (ou para o pai, se tiver).
insert into categoria_grupo_erp (erp_categoria_id, nome_erp, categoria_id)
select c.erp_categoria_id, c.nome, coalesce(c.pai_id, c.id)
  from categorias c
 where c.erp_categoria_id is not null
on conflict (erp_categoria_id) do nothing;
