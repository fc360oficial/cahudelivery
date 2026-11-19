-- Faixa de campanha no topo do site (19/11/2026): imagem ligada à promoção ("Ofertas da Semana").
-- Enquanto a promoção está vigente, a faixa aparece no lugar da barra preta do topo e leva para /ofertas.
-- faixa_url = arte do computador (1920x60); faixa_celular_url = arte do celular (780x120, opcional).
alter table promocoes add column if not exists faixa_url text;
alter table promocoes add column if not exists faixa_celular_url text;

insert into schema_migrations (versao) values ('045') on conflict do nothing;
