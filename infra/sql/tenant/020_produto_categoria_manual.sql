-- Categoria revisada manualmente na retaguarda/por curadoria: o sync de produtos do Dlinks
-- não sobrescreve categoria_id quando categoria_manual = true.
alter table produtos add column if not exists categoria_manual boolean not null default false;
