-- CAHU: reduzir o catálogo a 6 categorias raiz (pedido do Tiago, 17/09/2026).
--   Mercearia, Limpeza, Higiene e Beleza, Bebidas, Pet Shop, Variedades
--
-- O que faz:
--   1. Garante as 6 raízes (reaproveita Limpeza / Pet Shop / Bebidas se já existirem como raiz).
--   2. Pendura cada categoria antiga (grupo do Dlinks) numa raiz, por regra de nome,
--      e a deixa INATIVA (o app só mostra categoria ativa). Não apaga: o sync do
--      Dlinks recriaria todas.
--   3. Aponta todos os produtos direto para a raiz do seu grupo.
--   O sync de produtos (código) já cai na raiz do grupo para produto novo.
--
-- Como rodar (produção, no .254):
--   C:\PostgreSQL\16\bin\psql.exe -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f C:\cahudelivery\infra\scripts\cahu-6-categorias.sql
-- Rode primeiro só o bloco PRÉVIA (comentado abaixo) para conferir o mapeamento.
-- Reversível: ver bloco DESFAZER no fim.

create extension if not exists unaccent; -- para comparar nomes ignorando acento

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

-- Reaproveita categoria já existente com o mesmo nome (ignorando caixa/acento) que seja raiz;
-- senão cria. Nunca reaproveita uma que já esteja pendurada em outra.
insert into categorias (nome, slug, ordem, ativo)
select r.nome, r.slug, r.ordem, true
  from raiz r
 where not exists (
   select 1 from categorias c
    where c.pai_id is null and lower(unaccent(c.nome)) = lower(unaccent(r.nome)));

update categorias c
   set ordem = r.ordem, ativo = true, nome = r.nome
  from raiz r
 where c.pai_id is null and lower(unaccent(c.nome)) = lower(unaccent(r.nome));

-- 2. Regras de nome → raiz ----------------------------------------------------
-- Ordem importa: a primeira regra que bater vence. Ajuste/adicione linhas à vontade.
create temp table regra (prioridade int, padrao text, raiz text) on commit drop;
insert into regra values
  -- Pet
  (10, '(pet|racao|ração|cachorro|gato|animal)',                                   'Pet Shop'),
  -- Bebidas
  (20, '(bebida|refrigerante|cerveja|vinho|destilad|suco|agua|água|energetico|energético|isotonic|cha |chá |achocolatado liq)', 'Bebidas'),
  -- Higiene e Beleza
  (30, '(higiene|beleza|cabelo|shampoo|condicionador|sabonete|desodorante|absorvente|fralda|barbear|dental|bucal|escova|creme|perfum|cosmetic|cosmétic|maquiagem|papel higi)', 'Higiene e Beleza'),
  -- Limpeza (inclui lavanderia e descartáveis de limpeza)
  (40, '(limpeza|lavanderia|sabao|sabão|detergente|desinfetante|amaciante|alvejante|agua sanit|água sanit|esponja|lustra|inseticida|papel e descart|descart|saco de lixo|vassoura)', 'Limpeza'),
  -- Mercearia (alimentos secos, laticínios, café, doces, congelados)
  (50, '(mercearia|alimento|leite|laticin|laticín|iogurte|queijo|biscoito|snack|salgadinho|bolacha|cafe|café|achocolatado|acucar|açúcar|arroz|feijao|feijão|massa|macarrao|macarrão|molho|tempero|condiment|oleo|óleo|azeite|farinha|cereal|doce|chocolate|bala|bombom|conserva|enlatado|congelado|frios|carne|padaria|pao|pão|graos|grãos)', 'Mercearia');
-- Tudo que não bater em regra nenhuma vai para Variedades (calçados, utilidades, bazar…).

create temp table mapa on commit drop as
select c.id as categoria_id, c.nome as categoria,
       coalesce(
         (select r.raiz from regra r
           where lower(unaccent(c.nome)) ~ r.padrao
           order by r.prioridade limit 1),
         'Variedades') as raiz
  from categorias c
 where c.id not in (select c2.id from categorias c2 join raiz r on c2.pai_id is null and lower(unaccent(c2.nome)) = lower(unaccent(r.nome)));

-- PRÉVIA: descomente e rode só isto (com o begin) para conferir; depois rollback.
-- select categoria, raiz, (select count(*) from produtos p where p.categoria_id = m.categoria_id) as produtos
--   from mapa m order by raiz, categoria;
-- rollback;

-- 3. Aplica -------------------------------------------------------------------
update categorias c
   set pai_id = (select id from categorias x where x.pai_id is null and x.nome = m.raiz limit 1),
       ativo  = false
  from mapa m
 where c.id = m.categoria_id;

update produtos p
   set categoria_id = (select id from categorias x where x.pai_id is null and x.nome = m.raiz limit 1),
       categoria_manual = false
  from mapa m
 where p.categoria_id = m.categoria_id;

-- Produtos sem categoria nenhuma vão para Variedades.
update produtos
   set categoria_id = (select id from categorias where pai_id is null and nome = 'Variedades' limit 1)
 where categoria_id is null;

-- Conferência final
select c.nome as raiz, count(p.id) as produtos
  from categorias c left join produtos p on p.categoria_id = c.id
 where c.pai_id is null and c.ativo
 group by c.nome order by min(c.ordem);

commit;

-- DESFAZER (se precisar voltar ao estado anterior):
--   update produtos p set categoria_id = c.id
--     from categorias c where c.erp_categoria_id is not null and c.pai_id is not null
--      and p.erp_produto_id in (select erp_produto_id from produtos)  -- reatribui pelo grupo do Dlinks
--   -- mais simples: rode um sync de produtos do Dlinks depois de
--   update categorias set pai_id = null, ativo = true where erp_categoria_id is not null;
