-- Prazos de boleto disponíveis no checkout. Placeholder até a integração com
-- o Dlinks trazer o limite de crédito real por cliente (Fase 4) — por ora,
-- lista fixa igual pra todo cliente; a retaguarda pode editar em Configurações.
alter table pedidos add column if not exists condicao_pagamento text;

insert into configuracoes (chave, valor_json) values
  ('condicoes_boleto', '["À vista","30 dias","30/60 dias","30/60/90 dias"]')
on conflict (chave) do nothing;

insert into schema_migrations (versao) values ('005') on conflict do nothing;
