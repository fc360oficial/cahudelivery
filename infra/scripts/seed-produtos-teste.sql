-- =====================================================================
-- SEED DE TESTE — 5 produtos por categoria, todos com foto.
-- Fotos são placeholders gerados (placehold.co, cor por categoria) —
-- nenhuma imagem de marca real. Só para teste visual das prateleiras.
-- Idempotente: on conflict evita duplicar ao rodar de novo.
-- =====================================================================

-- Fotos para os 6 produtos que já existem (ainda sem imagem)
insert into produto_imagens (produto_id, url, ordem)
select p.id, v.url, 1 from (values
  ('DEMO-0001', 'https://placehold.co/500x500/2563eb/ffffff?text=Refrigerante+Cola'),
  ('DEMO-0002', 'https://placehold.co/500x500/2563eb/ffffff?text=Agua+Mineral'),
  ('DEMO-0003', 'https://placehold.co/500x500/b45309/ffffff?text=Arroz+Tipo+1'),
  ('DEMO-0004', 'https://placehold.co/500x500/b45309/ffffff?text=Feijao+Carioca'),
  ('DEMO-0005', 'https://placehold.co/500x500/0d9488/ffffff?text=Detergente+Neutro'),
  ('DEMO-0006', 'https://placehold.co/500x500/b45309/ffffff?text=Oleo+de+Soja')
) as v(sku, url)
join produtos p on p.sku = v.sku
where not exists (select 1 from produto_imagens pi where pi.produto_id = p.id);

-- Novos produtos: +3 Bebidas, +2 Mercearia, +4 Limpeza (chega a 5 por categoria)
insert into produtos (sku, nome, descricao, marca_id, categoria_id, unidade_venda, qtd_por_embalagem, qtd_minima, erp_produto_id)
select v.sku, v.nome, v.descricao, m.id, c.id, v.unidade, v.qtd_emb, 1, v.erp_id
from (values
  ('DEMO-0007', 'Suco de Laranja 1L (caixa 12un)', 'Caixa com 12 unidades de 1 litro.', 'Bebidas', 'CX', 12, 'ERP-P7'),
  ('DEMO-0008', 'Cerveja Pilsen 350ml (fardo 12un)', 'Fardo com 12 latas de 350ml.', 'Bebidas', 'FD', 12, 'ERP-P8'),
  ('DEMO-0009', 'Energético 250ml (caixa 24un)', 'Caixa com 24 latas de 250ml.', 'Bebidas', 'CX', 24, 'ERP-P9'),
  ('DEMO-0010', 'Açúcar Refinado 1kg (fardo 10un)', 'Fardo com 10 pacotes de 1kg.', 'Mercearia', 'FD', 10, 'ERP-P10'),
  ('DEMO-0011', 'Café Torrado 500g (caixa 10un)', 'Caixa com 10 pacotes de 500g.', 'Mercearia', 'CX', 10, 'ERP-P11'),
  ('DEMO-0012', 'Água Sanitária 1L (caixa 12un)', 'Caixa com 12 unidades de 1 litro.', 'Limpeza', 'CX', 12, 'ERP-P12'),
  ('DEMO-0013', 'Sabão em Pó 1kg (fardo 10un)', 'Fardo com 10 pacotes de 1kg.', 'Limpeza', 'FD', 10, 'ERP-P13'),
  ('DEMO-0014', 'Desinfetante 500ml (caixa 12un)', 'Caixa com 12 unidades de 500ml.', 'Limpeza', 'CX', 12, 'ERP-P14'),
  ('DEMO-0015', 'Papel Higiênico 30m (fardo 16un)', 'Fardo com 16 rolos de 30 metros.', 'Limpeza', 'FD', 16, 'ERP-P15')
) as v(sku, nome, descricao, categoria_nome, unidade, qtd_emb, erp_id)
join categorias c on c.nome = v.categoria_nome
left join marcas m on m.nome = 'Marca Demo B'
on conflict (sku) do nothing;

-- Preço (tabela padrão)
insert into precos (produto_id, tabela_preco_id, preco)
select p.id, 'a0000000-0000-4000-8000-000000000001', v.preco
from (values
  ('DEMO-0007', 54.90), ('DEMO-0008', 34.90), ('DEMO-0009', 119.90),
  ('DEMO-0010', 39.90), ('DEMO-0011', 89.90),
  ('DEMO-0012', 29.90), ('DEMO-0013', 69.90), ('DEMO-0014', 32.90), ('DEMO-0015', 59.90)
) as v(sku, preco)
join produtos p on p.sku = v.sku
on conflict (produto_id, tabela_preco_id) do update set preco = excluded.preco;

-- Estoque
insert into estoques (produto_id, quantidade)
select id, 100 from produtos where sku like 'DEMO-00%'
on conflict (produto_id) do update set quantidade = 100;

-- Fotos dos novos produtos (cor por categoria: azul=Bebidas, âmbar=Mercearia, verde=Limpeza)
insert into produto_imagens (produto_id, url, ordem)
select p.id, v.url, 1 from (values
  ('DEMO-0007', 'https://placehold.co/500x500/2563eb/ffffff?text=Suco+de+Laranja'),
  ('DEMO-0008', 'https://placehold.co/500x500/2563eb/ffffff?text=Cerveja+Pilsen'),
  ('DEMO-0009', 'https://placehold.co/500x500/2563eb/ffffff?text=Energetico'),
  ('DEMO-0010', 'https://placehold.co/500x500/b45309/ffffff?text=Acucar+Refinado'),
  ('DEMO-0011', 'https://placehold.co/500x500/b45309/ffffff?text=Cafe+Torrado'),
  ('DEMO-0012', 'https://placehold.co/500x500/0d9488/ffffff?text=Agua+Sanitaria'),
  ('DEMO-0013', 'https://placehold.co/500x500/0d9488/ffffff?text=Sabao+em+Po'),
  ('DEMO-0014', 'https://placehold.co/500x500/0d9488/ffffff?text=Desinfetante'),
  ('DEMO-0015', 'https://placehold.co/500x500/0d9488/ffffff?text=Papel+Higienico')
) as v(sku, url)
join produtos p on p.sku = v.sku
where not exists (select 1 from produto_imagens pi where pi.produto_id = p.id);
