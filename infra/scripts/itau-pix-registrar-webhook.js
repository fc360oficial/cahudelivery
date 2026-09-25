// infra/scripts/itau-pix-registrar-webhook.js
// Uso no .254: node infra/scripts/itau-pix-registrar-webhook.js C:\itau-cahu-pix\credencial.json https://cahudelivery.duckdns.org/v1/integracoes/pagamentos/<segredo>/webhook
// Registra a URL no Itaú (PUT /webhook/{chave}). O Itaú chama <url>/pix nas confirmações.
const fs = require('node:fs');
const path = require('node:path');
const { ItauPixProvedor } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'dist', 'pagamentos', 'itau-pix.provedor.js'));

const [credArq, url] = process.argv.slice(2);
if (!credArq || !url) { console.error('uso: credencial.json url'); process.exit(1); }
const cred = JSON.parse(fs.readFileSync(credArq, 'utf8'));
const prov = new ItauPixProvedor({
  chavePix: '61920643000148', nomeRecebedor: 'CAHU DISTRIBUIDORA', cidade: 'RECIFE',
  clientId: cred.clientId, clientSecret: cred.clientSecret, pfx: fs.readFileSync(cred.pfxArquivo), pfxSenha: cred.pfxSenha,
});
prov.registrarWebhook(url).then((r) => {
  console.log('status', r.status);
  console.log(r.texto.slice(0, 500));
});
