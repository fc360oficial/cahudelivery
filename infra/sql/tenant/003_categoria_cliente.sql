-- Categoria do estabelecimento do cliente (segmentação para catálogo/promoções).
alter table clientes add column if not exists categoria text;
