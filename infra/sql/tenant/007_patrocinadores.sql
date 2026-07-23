-- Vitrines patrocinadas por indústria/fabricante (benchmark Praso, 23/07/2026).
-- Produtos escolhidos manualmente (não por marca) — uma indústria pode incluir
-- produtos de várias marcas dela. Aparece na Home logo depois de uma categoria
-- escolhida (apos_categoria_id null = aparece no topo, antes de tudo).
create table if not exists patrocinadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text,
  banner_url text,
  apos_categoria_id uuid references categorias(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists patrocinador_produtos (
  patrocinador_id uuid not null references patrocinadores(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  preco_especial numeric,
  ordem int not null default 0,
  primary key (patrocinador_id, produto_id)
);

insert into schema_migrations (versao) values ('007') on conflict do nothing;