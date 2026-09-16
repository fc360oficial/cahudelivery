-- 023: geocodificação de endereços (Mapa da retaguarda)
alter table cliente_enderecos
  add column if not exists latitude                double precision,
  add column if not exists longitude               double precision,
  add column if not exists geo_precisao            text check (geo_precisao in ('cep','endereco')),
  add column if not exists geocodificado_em        timestamptz,
  add column if not exists geo_tentativas          int not null default 0,
  add column if not exists geo_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_geo_pendente_idx
  on cliente_enderecos (geo_tentativas) where latitude is null;
