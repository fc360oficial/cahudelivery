-- 024: município devolvido pela geocodificação (o campo cidade do cadastro não é confiável)
alter table cliente_enderecos
  add column if not exists geo_cidade text;
