-- infra/scripts/erede-provedor.sql  (banco de CONTROLE)
-- Cartão de crédito online via e.Rede (API v2, OAuth 2.0). Convive com o
-- itau_pix: o checkout escolhe o provedor pelo método (pix | cartao).
-- Uso: psql -v slug=cahu -f infra/scripts/erede-provedor.sql
-- O arquivo de credencial fica FORA do repo (ex.: C:\erede-cahu\credencial.json):
--   { "pv": "109038630", "chaveIntegracao": "<chave gerada no portal userede>" }
-- Atenção: gerar nova chave no portal invalida a anterior na hora — se alguém
-- gerar de novo, atualizar o arquivo imediatamente.
insert into pagamento_provedores (tenant_id, provedor, config_json)
select t.id, 'erede', jsonb_build_object(
  'credencialArquivo', 'C:\erede-cahu\credencial.json',
  'softDescriptor', 'CAHUDELIVERY',
  'ambiente', 'producao',
  'expiracaoSegundos', 1800)
  from tenants t where t.slug = :'slug'
on conflict (tenant_id, provedor) do update set config_json = excluded.config_json, ativo = true;

-- Depois de rodar: reiniciar a API (o ProvedoresService cacheia por slug) e
-- na retaguarda ligar 'cartao' em formas_pagamento + 'cartao_online' = true:
--   (banco do TENANT)
--   insert into configuracoes (chave, valor_json) values ('cartao_online', 'true')
--     on conflict (chave) do update set valor_json = 'true';