-- 028: Inscricao Estadual do cliente e codigo IBGE do municipio do endereco.
-- A IE fica em clientes porque e atributo do CNPJ. O codigo do municipio fica
-- em cliente_enderecos porque um cliente com dois enderecos tem dois municipios.
alter table clientes
  add column if not exists inscricao_estadual text;

alter table cliente_enderecos
  add column if not exists codigo_municipio              text,
  add column if not exists municipio_tentativas          int not null default 0,
  add column if not exists municipio_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_municipio_pendente_idx
  on cliente_enderecos (municipio_tentativas) where codigo_municipio is null;
