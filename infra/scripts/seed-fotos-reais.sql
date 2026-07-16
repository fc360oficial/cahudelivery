-- =====================================================================
-- Substitui as fotos placeholder (placehold.co) pelas fotos reais e
-- verificadas (Pexels — licença livre, sem marca) — só pra teste visual.
-- Cada URL foi conferida (HTTP 200, image/jpeg) antes de usar.
-- Idempotente (UPDATE puro, seguro rodar de novo).
-- =====================================================================

update produto_imagens pi set url = v.url from (values
  ('DEMO-0001','https://images.pexels.com/photos/1904262/pexels-photo-1904262.jpeg?w=500'),   -- Refrigerante Cola
  ('DEMO-0002','https://images.pexels.com/photos/8217497/pexels-photo-8217497.jpeg?w=500'),   -- Água Mineral
  ('DEMO-0007','https://images.pexels.com/photos/8750912/pexels-photo-8750912.jpeg?w=500'),   -- Suco de Laranja
  ('DEMO-0008','https://images.pexels.com/photos/5532668/pexels-photo-5532668.jpeg?w=500'),   -- Cerveja Pilsen
  ('DEMO-0009','https://images.pexels.com/photos/12310175/pexels-photo-12310175.jpeg?w=500'), -- Energético
  ('DEMO-0003','https://images.pexels.com/photos/5167396/pexels-photo-5167396.jpeg?w=500'),   -- Arroz Tipo 1
  ('DEMO-0004','https://images.pexels.com/photos/5843559/pexels-photo-5843559.jpeg?w=500'),   -- Feijão Carioca
  ('DEMO-0006','https://images.pexels.com/photos/12284682/pexels-photo-12284682.jpeg?w=500'), -- Óleo de Soja
  ('DEMO-0010','https://images.pexels.com/photos/21582446/pexels-photo-21582446.jpeg?w=500'), -- Açúcar Refinado
  ('DEMO-0011','https://images.pexels.com/photos/19052799/pexels-photo-19052799.jpeg?w=500'), -- Café Torrado
  ('DEMO-0005','https://images.pexels.com/photos/5218021/pexels-photo-5218021.jpeg?w=500'),   -- Detergente Neutro
  ('DEMO-0012','https://images.pexels.com/photos/7451952/pexels-photo-7451952.jpeg?w=500'),   -- Água Sanitária
  ('DEMO-0013','https://images.pexels.com/photos/5591956/pexels-photo-5591956.jpeg?w=500'),   -- Sabão em Pó
  ('DEMO-0014','https://images.pexels.com/photos/10557902/pexels-photo-10557902.jpeg?w=500'), -- Desinfetante
  ('DEMO-0015','https://images.pexels.com/photos/3963082/pexels-photo-3963082.jpeg?w=500')    -- Papel Higiênico
) as v(sku, url)
join produtos p on p.sku = v.sku
where pi.produto_id = p.id;
