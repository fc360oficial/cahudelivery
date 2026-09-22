-- Credencial do webhook da MaxiPago (banco de CONTROLE: fluxo_control).
-- O segredo em texto puro NÃO fica no repositório: ele vive só na URL registrada
-- na ficha da Rede. Aqui guardamos apenas o sha256.
--
-- Gerar um segredo novo:      node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
-- Calcular o hash do segredo: node -e "console.log(require('crypto').createHash('sha256').update('<segredo>').digest('hex'))"
--
-- Rotacionar = rodar de novo com o hash novo e desativar o antigo:
--   update integracao_credenciais set ativo = false
--    where adaptador = 'maxipago' and apikey_hash = '<hash antigo>';

insert into integracao_credenciais (tenant_id, adaptador, apikey_hash)
select t.id, 'maxipago', :'hash'
  from tenants t
 where t.slug = :'slug'
on conflict (apikey_hash) do nothing;
