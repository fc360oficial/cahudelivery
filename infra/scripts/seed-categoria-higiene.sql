-- =====================================================================
-- SEED DE TESTE — categoria Higiene, 5 produtos, todos com foto.
-- Fotos reais e livres de uso (Pexels — free license, sem marca), só pra
-- teste visual. Cada URL foi conferida (HTTP 200, image/jpeg) antes de usar.
-- Idempotente.
-- =====================================================================

insert into categorias (nome, slug, ordem)
values ('Higiene', 'higiene-' || substr(gen_random_uuid()::text, 1, 8), 4)
on conflict (slug) do nothing;

insert into produtos (sku, nome, descricao, marca_id, categoria_id, unidade_venda, qtd_por_embalagem, qtd_minima, erp_produto_id)
select v.sku, v.nome, v.descricao, m.id, c.id, v.unidade, v.qtd_emb, 1, v.erp_id
from (values
  ('DEMO-0016', 'Sabonete 90g (fardo 12un)', 'Fardo com 12 unidades de 90g.', 'FD', 12, 'ERP-P16'),
  ('DEMO-0017', 'Creme Dental 90g (caixa 12un)', 'Caixa com 12 unidades de 90g.', 'CX', 12, 'ERP-P17'),
  ('DEMO-0018', 'Shampoo 350ml (caixa 12un)', 'Caixa com 12 frascos de 350ml.', 'CX', 12, 'ERP-P18'),
  ('DEMO-0019', 'Absorvente Higiênico (fardo 24un)', 'Fardo com 24 pacotes.', 'FD', 24, 'ERP-P19'),
  ('DEMO-0020', 'Escova de Dentes (caixa 12un)', 'Caixa com 12 unidades.', 'CX', 12, 'ERP-P20')
) as v(sku, nome, descricao, unidade, qtd_emb, erp_id)
join categorias c on c.nome = 'Higiene'
left join marcas m on m.nome = 'Marca Demo B'
on conflict (sku) do nothing;

insert into precos (produto_id, tabela_preco_id, preco)
select p.id, 'a0000000-0000-4000-8000-000000000001', v.preco
from (values
  ('DEMO-0016', 24.90), ('DEMO-0017', 44.90), ('DEMO-0018', 59.90),
  ('DEMO-0019', 79.90), ('DEMO-0020', 34.90)
) as v(sku, preco)
join produtos p on p.sku = v.sku
on conflict (produto_id, tabela_preco_id) do update set preco = excluded.preco;

insert into estoques (produto_id, quantidade)
select id, 100 from produtos where sku in ('DEMO-0016','DEMO-0017','DEMO-0018','DEMO-0019','DEMO-0020')
on conflict (produto_id) do update set quantidade = 100;

insert into produto_imagens (produto_id, url, ordem)
select p.id, v.url, 1 from (values
  ('DEMO-0016', 'https://images.pexels.com/photos/6690843/pexels-photo-6690843.jpeg?w=500'),
  ('DEMO-0017', 'https://images.pexels.com/photos/4465814/pexels-photo-4465814.jpeg?w=500'),
  ('DEMO-0018', 'https://images.pexels.com/photos/13516802/pexels-photo-13516802.jpeg?w=500'),
  ('DEMO-0019', 'https://images.pexels.com/photos/3958548/pexels-photo-3958548.jpeg?w=500'),
  ('DEMO-0020', 'https://images.pexels.com/photos/3654597/pexels-photo-3654597.jpeg?w=500')
) as v(sku, url)
join produtos p on p.sku = v.sku
where not exists (select 1 from produto_imagens pi where pi.produto_id = p.id);
