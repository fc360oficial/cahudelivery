-- infra/scripts/itau-pix-provedor.sql  (banco de CONTROLE)
-- Uso: psql -v slug=cahu -v hash=<sha256 do segredo do webhook> -f infra/scripts/itau-pix-provedor.sql
-- O segredo em texto puro só vive na URL cadastrada no Itaú. Gerar:
--   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
--   node -e "console.log(require('crypto').createHash('sha256').update('<segredo>').digest('hex'))"
insert into pagamento_provedores (tenant_id, provedor, config_json)
select t.id, 'itau_pix', jsonb_build_object(
  'chavePix', '61920643000148',
  'nomeRecebedor', 'CAHU DISTRIBUIDORA',
  'cidade', 'RECIFE',
  'expiracaoSegundos', 1800,
  'credencialArquivo', 'C:\itau-cahu-pix\credencial.json',
  'webhookSegredoHash', :'hash')
  from tenants t where t.slug = :'slug'
on conflict (tenant_id, provedor) do update set config_json = excluded.config_json, ativo = true;
