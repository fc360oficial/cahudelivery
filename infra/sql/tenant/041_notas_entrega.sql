-- infra/sql/tenant/041_notas_entrega.sql
-- Fluxo Entregas (16/11/2026): notas faturadas de entrega que NÃO nasceram no Fluxo Commerce.
-- O pedido digitado direto no ERP (televendas) não existe na tabela pedidos; o ERP avisa o faturamento em
-- POST /v1/integracoes/dlinks/notas-entrega e a nota fica aqui, para entrar na montagem de carga junto
-- com os pedidos do aplicativo, do site e do Fluxo Vendas (que continuam em pedidos + pedido_notas).
--  * a chave de acesso identifica a nota: reenviar corrige, status CANCELADO tira da carga;
--  * total, itens, volumes, peso e destinatário são lidos do XML (o XML é a fonte da verdade);
--  * cliente_id fica nulo quando o código do cliente ainda não foi sincronizado (o endereço vem do XML).
-- Não altera nenhuma tabela existente. Repetível: pode rodar mais de uma vez.

create table if not exists notas_entrega (
  id                uuid primary key default gen_random_uuid(),
  chave_acesso      text not null unique,
  numero_nf         text not null,
  serie             text not null default '',
  pedido_numero     text,                       -- número do pedido no ERP (informativo)
  origem            text not null default 'televendas',
  cliente_id        uuid references clientes(id) on delete set null,
  cliente_codigo    text,                       -- código do cliente no ERP, como veio
  tipo_entrega      text not null default 'entrega' check (tipo_entrega in ('entrega','retirada')),
  status            text not null default 'FATURADO' check (status in ('FATURADO','CANCELADO')),
  total             numeric(14,2),
  volumes           numeric(12,3),              -- qVol do XML; nulo quando a nota não informa
  peso_bruto_kg     numeric(12,3),              -- pesoB do XML; nulo quando a nota não informa
  destinatario_json jsonb,                      -- nome, documento, telefone e endereço do destinatário (do XML)
  itens_json        jsonb,                      -- código, descrição, unidade, quantidade e valores (do XML)
  xml               text,                       -- decodificado, como em pedido_notas
  emitida_em        timestamptz,
  recebida_em       timestamptz not null default now(),
  atualizada_em     timestamptz not null default now()
);

create index if not exists notas_entrega_a_entregar
  on notas_entrega (emitida_em) where status = 'FATURADO' and tipo_entrega = 'entrega';
create index if not exists notas_entrega_cliente on notas_entrega (cliente_id);

insert into schema_migrations (versao) values ('041') on conflict do nothing;
