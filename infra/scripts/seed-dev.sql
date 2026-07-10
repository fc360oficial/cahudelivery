-- =====================================================================
-- Fluxo Commerce — SEED DE DESENVOLVIMENTO (dados sintéticos)
-- Aplicar apenas em bancos de dev: psql -d fluxo_t_cahu -f seed-dev.sql
-- Idempotente: usa on conflict / where not exists.
-- =====================================================================

insert into tabelas_preco (id, nome, padrao)
values ('a0000000-0000-4000-8000-000000000001', 'Tabela Padrão', true)
on conflict do nothing;

insert into marcas (id, nome) values
  ('b0000000-0000-4000-8000-000000000001', 'Marca Demo A'),
  ('b0000000-0000-4000-8000-000000000002', 'Marca Demo B')
on conflict do nothing;

insert into categorias (id, nome, slug, ordem) values
  ('c0000000-0000-4000-8000-000000000001', 'Bebidas', 'bebidas', 1),
  ('c0000000-0000-4000-8000-000000000002', 'Mercearia', 'mercearia', 2),
  ('c0000000-0000-4000-8000-000000000003', 'Limpeza', 'limpeza', 3)
on conflict do nothing;

insert into produtos (id, sku, nome, descricao, marca_id, categoria_id, unidade_venda, qtd_por_embalagem, qtd_minima, erp_produto_id)
values
  ('d0000000-0000-4000-8000-000000000001', 'DEMO-0001', 'Refrigerante Cola 2L (fardo 6un)', 'Fardo com 6 garrafas de 2 litros.', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'FD', 6, 1, 'ERP-P1'),
  ('d0000000-0000-4000-8000-000000000002', 'DEMO-0002', 'Água Mineral 500ml (caixa 12un)', 'Caixa com 12 garrafas.', 'b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'CX', 12, 1, 'ERP-P2'),
  ('d0000000-0000-4000-8000-000000000003', 'DEMO-0003', 'Arroz Tipo 1 5kg', 'Pacote de 5kg.', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'UN', 1, 2, 'ERP-P3'),
  ('d0000000-0000-4000-8000-000000000004', 'DEMO-0004', 'Feijão Carioca 1kg (fardo 10un)', 'Fardo com 10 pacotes.', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'FD', 10, 1, 'ERP-P4'),
  ('d0000000-0000-4000-8000-000000000005', 'DEMO-0005', 'Detergente Neutro 500ml (caixa 24un)', 'Caixa com 24 unidades.', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000003', 'CX', 24, 1, 'ERP-P5'),
  ('d0000000-0000-4000-8000-000000000006', 'DEMO-0006', 'Óleo de Soja 900ml (caixa 20un)', 'Caixa com 20 unidades.', 'b0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'CX', 20, 1, 'ERP-P6')
on conflict do nothing;

insert into precos (produto_id, tabela_preco_id, preco)
select p.id, 'a0000000-0000-4000-8000-000000000001', v.preco
from (values
  ('DEMO-0001', 42.90), ('DEMO-0002', 18.50), ('DEMO-0003', 24.90),
  ('DEMO-0004', 79.90), ('DEMO-0005', 55.00), ('DEMO-0006', 139.00)
) as v(sku, preco)
join produtos p on p.sku = v.sku
on conflict (produto_id, tabela_preco_id) do update set preco = excluded.preco;

insert into estoques (produto_id, quantidade)
select id, 100 from produtos
on conflict (produto_id) do update set quantidade = 100;

insert into promocoes (id, nome, inicio_em, fim_em)
values ('e0000000-0000-4000-8000-000000000001', 'Oferta da Semana', now() - interval '1 day', now() + interval '7 days')
on conflict do nothing;

insert into promocao_produtos (promocao_id, produto_id, preco_promocional)
values ('e0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 38.90)
on conflict do nothing;

insert into banners (titulo, imagem_url, destino_tipo, destino_id, ordem)
select 'Oferta da Semana', 'https://placehold.co/1200x400', 'promocao', 'e0000000-0000-4000-8000-000000000001', 1
where not exists (select 1 from banners);
