-- CAHU: catálogo com SÓ 6 categorias (pedido do Tiago, 17/09/2026).
--   Mercearia, Limpeza, Higiene e Beleza, Bebidas, Pet Shop, Variedades
--
-- Pré-requisito: migração 025 (tabela categoria_grupo_erp) aplicada.
--
-- O que faz:
--   1. Garante as 6 raízes. Reaproveita as existentes com o mesmo nome (mantém a foto);
--      "Higiene Pessoal" (com foto) vira "Higiene e Beleza".
--   2. Monta o mapa "categoria antiga → uma das 6" por regra de nome (sem match → Variedades).
--   3. Move TODOS os produtos, patrocinadores e o mapa grupo-do-Dlinks para as 6.
--   4. APAGA todas as outras categorias.
--   O sync do Dlinks (código) não recria categoria: grupo novo entra só em
--   categoria_grupo_erp e produto novo cai na categoria mapeada (ou Variedades).
--
-- Como rodar (produção, no .254):
--   C:\PostgreSQL\16\bin\psql.exe -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f C:\cahudelivery\infra\scripts\cahu-6-categorias.sql

create extension if not exists unaccent;

begin;

-- 1. Raízes ----------------------------------------------------------------
create temp table raiz (nome text, slug text, ordem int) on commit drop;
insert into raiz values
  ('Mercearia',        'mercearia',        1),
  ('Limpeza',          'limpeza',          2),
  ('Higiene e Beleza', 'higiene-e-beleza', 3),
  ('Bebidas',          'bebidas',          4),
  ('Pet Shop',         'pet-shop',         5),
  ('Variedades',       'variedades',       6);

-- "Higiene Pessoal" (tem foto) passa a ser a raiz Higiene e Beleza.
update categorias set nome = 'Higiene e Beleza'
 where lower(unaccent(nome)) = 'higiene pessoal'
   and not exists (select 1 from categorias where lower(unaccent(nome)) = 'higiene e beleza');

-- Se houver mais de uma com o mesmo nome, fica a que tem foto (ou mais produtos); o resto cai na regra.
create temp table escolhida on commit drop as
select distinct on (lower(unaccent(c.nome))) c.id, r.nome as raiz
  from categorias c join raiz r on lower(unaccent(c.nome)) = lower(unaccent(r.nome))
 order by lower(unaccent(c.nome)), (c.imagem_url is not null) desc,
          (select count(*) from produtos p where p.categoria_id = c.id) desc;

insert into categorias (nome, slug, ordem, ativo)
select r.nome, r.slug, r.ordem, true from raiz r
 where not exists (select 1 from escolhida e where e.raiz = r.nome);

update categorias c
   set nome = r.nome, slug = r.slug, ordem = r.ordem, ativo = true, pai_id = null
  from raiz r
 where c.id in (select id from escolhida e where e.raiz = r.nome);

create temp table raiz_id on commit drop as
select r.nome as raiz, c.id from raiz r join categorias c on c.nome = r.nome and c.pai_id is null;

-- 2. Regras de nome → raiz (a primeira que bater vence) --------------------
create temp table regra (prioridade int, padrao text, raiz text) on commit drop;
insert into regra values
  (10, '(pet|racao|cachorro|gato|animal)',                                                   'Pet Shop'),
  (20, '(bebida|refrigerante|cerveja|vinho|destilad|suco|agua|energetic|isotonic|\ycha\y)',  'Bebidas'),
  (30, '(higiene|beleza|cabelo|shampoo|condicionador|sabonete|desodorante|absorvente|fralda|barbear|dental|bucal|escova|creme|perfum|cosmetic|maquiagem)', 'Higiene e Beleza'),
  (40, '(limpeza|lavanderia|sabao|detergente|desinfetante|amaciante|alvejante|sanit|esponja|lustra|inseticida|descart|saco de lixo|vassoura|papel)', 'Limpeza'),
  (50, '(mercearia|alimento|leite|laticin|iogurte|queijo|biscoito|snack|salgadinho|bolacha|cafe|achocolatado|acucar|arroz|feijao|massa|macarrao|molho|tempero|condiment|mostarda|oleo|azeite|farinha|cereal|doce|chocolate|bala|bombom|conserva|enlatado|congelado|frios|flv|carne|padaria|pao|grao|diet|festa|lanchonete|matinais|matinal)', 'Mercearia');

create temp table mapa on commit drop as
select c.id as categoria_id, c.nome as categoria,
       coalesce((select r.raiz from regra r where lower(unaccent(c.nome)) ~ r.padrao order by r.prioridade limit 1), 'Variedades') as raiz
  from categorias c
 where c.id not in (select id from raiz_id);

-- Prévia do mapeamento (só informativa)
select m.categoria, m.raiz, (select count(*) from produtos p where p.categoria_id = m.categoria_id) as produtos
  from mapa m order by m.raiz, m.categoria;

-- 3. Move tudo para as 6 ---------------------------------------------------------
update produtos p
   set categoria_id = ri.id, categoria_manual = false
  from mapa m join raiz_id ri on ri.raiz = m.raiz
 where p.categoria_id = m.categoria_id;

update produtos
   set categoria_id = (select id from raiz_id where raiz = 'Variedades')
 where categoria_id is null;

update patrocinadores pt
   set apos_categoria_id = ri.id
  from mapa m join raiz_id ri on ri.raiz = m.raiz
 where pt.apos_categoria_id = m.categoria_id;

-- Mapa grupo do Dlinks → categoria: grupos que eram categoria vão para a raiz mapeada;
-- os que já apontavam para uma das 6 continuam.
insert into categoria_grupo_erp (erp_categoria_id, nome_erp, categoria_id)
select c.erp_categoria_id, c.nome, ri.id
  from categorias c join mapa m on m.categoria_id = c.id join raiz_id ri on ri.raiz = m.raiz
 where c.erp_categoria_id is not null
on conflict (erp_categoria_id) do update set categoria_id = excluded.categoria_id, nome_erp = excluded.nome_erp, atualizado_em = now();

update categoria_grupo_erp g
   set categoria_id = ri.id
  from mapa m join raiz_id ri on ri.raiz = m.raiz
 where g.categoria_id = m.categoria_id;

-- Grupos do ERP ainda sem categoria (nunca viraram categoria) caem em Variedades.
update categoria_grupo_erp set categoria_id = (select id from raiz_id where raiz = 'Variedades')
 where categoria_id is null;

-- 4. Apaga todas as outras --------------------------------------------------------
update categorias set pai_id = null where pai_id in (select categoria_id from mapa);
delete from categorias where id in (select categoria_id from mapa);

-- Conferência final
select c.nome as categoria, c.imagem_url is not null as tem_foto, count(p.id) as produtos
  from categorias c left join produtos p on p.categoria_id = c.id
 group by c.id, c.nome, c.ordem order by c.ordem;

commit;
