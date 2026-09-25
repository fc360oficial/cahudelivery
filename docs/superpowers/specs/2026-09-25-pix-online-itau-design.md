# PIX online no checkout via API PIX Itaú — design

Data: 2026-09-25. Tenant alvo: CAHU Distribuidora (CNPJ 61.920.643/0001-48, Itaú ag 0877 cc 98111-8).

## Objetivo

Cobrar o PIX na hora do pedido, com QR Code na tela do app, e só liberar o pedido pro Dlinks depois que o Itaú confirmar o pagamento. Estrutura genérica de pagamentos pra receber cartão online (Rede/e.Rede) depois sem mexer de novo em pedido, app ou retaguarda.

Fora de escopo: boleto (desligado no app), cartão online (sem PV da Rede ainda), devolução automática por corte de item no faturamento.

## Decisões fechadas com o Tiago

- Cobrança gerada no checkout, antes do pedido ir pro Dlinks.
- Sem pagar em 30 minutos, o pedido é cancelado.
- Chave PIX recebedora: CNPJ 61.920.643/0001-48.
- Cartão continua "na entrega" (maquininha), mas a tabela e o contrato de provedor já nascem prontos pra cartão online.

## Credencial já pronta

Certificado dinâmico gerado em 25/09/2026 no `.254`, pasta `C:\itau-cahu-pix\` (certificado.pfx senha `itau2026`, ClientID_e_Secret.txt, chave privada). Token OAuth testado: 200 com escopos `cob.write cob.read pix.read pix.write webhook.write webhook.read cobv.* payloadlocation.* lotecobv.write`. Validade do certificado: até 25/09/2027, renovar 30 dias antes.

## Fluxo do pedido

Status novo em `pedidos`: `AGUARDANDO_PAGAMENTO`. Entra antes de `RECEBIDO` e só existe pra pedidos com pagamento online. Cartão na entrega e boleto continuam nascendo em `RECEBIDO`.

1. App faz `POST /pedidos` com `formaPagamento: 'pix'`. A API, numa transação: cria o pedido em `AGUARDANDO_PAGAMENTO`, desconta saldo da carteira se usado, cria uma linha em `pagamentos` com status `pendente`.
2. Ainda na mesma requisição, chama o provedor (`ItauPixProvedor.criarCobranca`): `PUT /cob/{txid}` com chave CNPJ, valor total, expiração 1800 s, `solicitacaoPagador` = "Pedido #NNNN CAHU Delivery". Grava `provedor_ref` (txid), `copia_cola`, `expira_em`, `payload_json`. Se o Itaú falhar, rollback total: pedido não existe, app recebe erro "Não foi possível gerar o PIX, tente de novo".
3. Resposta do `POST /pedidos` inclui `pagamento: { metodo, status, valor, copiaCola, expiraEm }`.
4. Confirmação chega por webhook (`POST /v1/integracoes/itau-pix/:segredo/webhook`) ou pelo worker de consulta. Transição `pendente → pago`: `update pagamentos set status='pago', pago_em, valor_pago where id=$1 and status='pendente'`; se afetou 1 linha, `pedidos.status = 'RECEBIDO'` + evento `RECEBIDO` origem `sistema` detalhe "PIX pago". A partir daí o Dlinks enxerga o pedido.
5. Expiração: worker vê cobrança com status `REMOVIDA_PELO_PSP`/`REMOVIDA_PELO_USUARIO_RECEBEDOR` ou `expira_em` passado com status ainda `ATIVA` consultado como não paga. Transição `pendente → expirado`; pedido vira `CANCELADO` com evento "PIX expirado" origem `sistema`, e estorna o saldo de carteira usado (mesma rotina de estorno já usada no cancelamento vindo do Dlinks).

Idempotência: toda transição usa `where status = 'pendente'`; webhook repetido ou consulta concorrente não gera evento duplicado.

Valor pago diferente do cobrado: marca `pago` e registra `valor_pago`. PIX de valor fixo não permite diferença; é só defesa.

## Dados

### `pagamentos` (banco do tenant, migração 029)

| coluna | tipo | obs |
|---|---|---|
| id | uuid pk | |
| pedido_id | uuid fk pedidos | índice |
| provedor | text | `itau_pix`, futuro `rede_cartao`, `mock` |
| metodo | text | `pix` / `cartao` |
| status | text | `pendente`, `pago`, `expirado`, `cancelado`, `falhou` |
| valor | numeric(12,2) | valor cobrado |
| valor_pago | numeric(12,2) | preenchido no pago |
| provedor_ref | text | txid do Itaú; único por provedor |
| copia_cola | text | BR Code do PIX |
| expira_em | timestamptz | |
| pago_em | timestamptz | |
| payload_json | jsonb | última resposta crua do provedor |
| criado_em / atualizado_em | timestamptz | |

Índice parcial `(expira_em) where status = 'pendente'` pro worker. Constraint: um pagamento `pendente` ou `pago` por pedido.

`pedidos.status` ganha o valor `AGUARDANDO_PAGAMENTO` no check constraint e em `PEDIDO_STATUS` do shared-types (que também precisa incorporar `ABERTO` e `EM_FATURAMENTO` da migração 026, hoje ausentes).

### `pagamento_webhooks` (027) vira fila genérica

Coluna `origem` aceita `itau_pix`. Processador lê `processado = false`, extrai `pix[].txid`, casa com `pagamentos.provedor_ref`, aplica a transição, marca `processado = true` ou grava `erro`.

### `pagamento_provedores` (banco de controle, migração 003)

| coluna | tipo |
|---|---|
| id | uuid pk |
| tenant_id | uuid fk tenants |
| provedor | text (`itau_pix`) |
| ativo | boolean |
| config_json | jsonb |

`config_json` do Itaú: `{ "chavePix": "61920643000148", "expiracaoSegundos": 1800, "credencialArquivo": "C:\\itau-cahu-pix\\credencial.json", "webhookSegredoHash": "<sha256>" }`. O arquivo `credencial.json` fica fora do repo no `.254` com `clientId`, `clientSecret`, `pfxArquivo`, `pfxSenha`. Segredo nunca entra no repositório nem no banco.

`pedido_cobrancas` não muda: continua sendo cobrança gerada pelo ERP.

## API

Módulo novo `apps/api/src/pagamentos/`:

- `provedor-pagamento.ts`: interface `ProvedorPagamento { criarCobranca(p): Promise<CobrancaCriada>; consultar(ref): Promise<SituacaoCobranca>; tratarWebhook(corpo): Promise<RefsPagas[]> }`.
- `itau-pix.provedor.ts`: token OAuth `client_credentials` em `https://sts.itau.com.br/api/oauth/token` com mTLS (pfx), cache de 4 min (expira em 5). Cobrança em `https://secure.api.itau/pix_recebimentos/v2/cob/{txid}` (URL base confirmada no primeiro teste real; o devportal lista o endpoint de produção). Header `x-itau-apikey` = clientId e `x-itau-correlationID` uuid, mesmo padrão do Extrato. Se a resposta do `PUT /cob` não trouxer o BR Code pronto, monta a partir do `location` conforme o padrão BCB.
- `mock.provedor.ts`: gera txid e copia-e-cola fake, nunca chama rede. Usado quando `pagamento_provedores` do tenant é `mock` (dev) e nos testes.
- `pagamentos.service.ts`: `criarParaPedido(client, pedidoId, valor)` chamado dentro da transação do `OrdersService.criar`; `confirmarPago(pagamentoId, valorPago, pagoEm)`; `expirar(pagamentoId)`; `consultarAgora(pedidoId)` pro botão da retaguarda.
- `pagamentos.worker.ts`: a cada 30 s, por tenant ativo com provedor configurado, consulta pendentes (limite 50, mais antigos primeiro), aplica pago/expirado. Desligável por `PAGAMENTOS_DESLIGADO=1` como os outros workers.
- `itau-pix-webhook.controller.ts` + middleware de segredo na URL, copiado do padrão MaxiPago (`integracao_credenciais` adaptador `itau_pix`). Responde 200 sempre que gravar.
- Endpoint admin `POST /admin/pedidos/:id/pagamento/consultar` (retaguarda) e, só com provedor mock, `POST /admin/pedidos/:id/pagamento/simular-pago`.
- Logs em `integracao_logs` com operações `itau_pix_cob`, `itau_pix_consulta`, `itau_pix_webhook`.

Setup único por tenant: registrar o webhook no Itaú (`PUT /webhook/{chave}` com `webhookUrl = https://cahudelivery.duckdns.org/v1/integracoes/itau-pix/<segredo>/webhook`). Script em `infra/scripts/itau-pix-registrar-webhook.js` rodado no `.254`.

`OrdersService.criar`: quando `formaPagamento === 'pix'` e o tenant tem provedor ativo, status inicial `AGUARDANDO_PAGAMENTO` e chama `pagamentos.criarParaPedido`. Sem provedor configurado, comportamento antigo (nasce `RECEBIDO`), o que mantém outros tenants intactos.

`OrdersService.detalhe` e `listar` passam a devolver `pagamento` (linha de `pagamentos` mais recente).

## Dlinks

Nada muda do lado do Dlinks: nenhuma tela, tabela ou campo deles, e o contrato dos endpoints que consomem segue igual.

- `GET /integracoes/dlinks/pedidos` (`listar`) exclui `status = 'AGUARDANDO_PAGAMENTO'`. Pedido PIX só aparece depois de pago; pedido expirado nunca aparece.
- `POST .../recebido` já só aceita `RECEBIDO`; não há caminho pra confirmar pedido não pago.
- Campo opcional novo na resposta de `listar`: `pagamentoOnline: { status: 'pago', pagoEm, txid, valor }` quando existir. Dlinks pode ignorar.
- Operação da CAHU: o dinheiro já está na conta quando o pedido chega no Dlinks. O faturamento não pode gerar cobrança nova; como o título é dado como quitado no Dlinks é combinação com eles, fora deste projeto. `pagamentoOnline` é a referência.
- Corte de item no faturamento: cliente pagou o total, Dlinks fatura menos. V1: devolução manual pelo Itaú; retaguarda mostra "valor a devolver" no card de pagamento quando `valores.total` do `pedidos-faturados` for menor que `valor_pago`.

## App (Flutter)

- Checkout: opção PIX com descrição "Pague na hora pelo QR Code"; some o aviso de cobrança no faturamento.
- Tela nova `pagamento_pix_screen.dart`: valor, QR desenhado com `qr_flutter` a partir do `copiaCola`, botão "Copiar código PIX", contador regressivo até `expiraEm`, texto "Assim que pagar, o pedido segue automaticamente". Polling `GET /pedidos/:id` a cada 5 s; ao sair de `AGUARDANDO_PAGAMENTO` mostra confirmação e abre o detalhe. Sem rede, mantém QR e contador e retoma o polling.
- Detalhe do pedido: bloco de pagamento com os três estados (pendente com QR, pago com data, expirado com botão Repetir). Reaproveita `_cartaoCobranca` como base.
- Lista de pedidos: badge "Aguardando pagamento".
- Abrir o app com pedido pendente: a lista leva direto pro bloco de QR no detalhe.

## Retaguarda (React)

- `Pedidos.tsx`: filtro e badge `AGUARDANDO_PAGAMENTO` ("Aguardando pagamento", âmbar).
- `PedidoDetalhe.tsx`: card "Pagamento" com método, provedor, valor, status, txid, criado/pago/expira, botão "Consultar no Itaú", e "valor a devolver" quando aplicável.
- `Configuracoes.tsx`: sem campo novo; chave PIX e expiração ficam em `pagamento_provedores`.
- `Logs.tsx`: já lista `integracao_logs`, aparece sem mudança.

## Erros e limites

- Itaú fora no checkout: rollback, erro claro no app, nada gravado.
- Webhook perdido: worker cobre em até 30 s.
- Webhook antes do commit do pedido: não acontece, a cobrança só é criada dentro da transação e o webhook chega depois do pagamento.
- Token expirado no meio: provedor renova e tenta uma vez.
- Dois pagamentos do mesmo QR: Itaú recusa o segundo (cobrança CONCLUIDA).
- Certificado vencendo: worker loga aviso quando faltar 30 dias (`notAfter` do pfx).

## Testes

- Unitários: transições de `PagamentosService` (pago idempotente, expirado com estorno de saldo, webhook repetido), parser do corpo do webhook, montagem do BR Code a partir do location, exclusão de `AGUARDANDO_PAGAMENTO` no `listar` do Dlinks.
- Provedor mock cobre o fluxo do app e da retaguarda em dev.
- Itaú real: teste manual em produção com pedido de R$ 0,01 pago pelo Tiago; não há sandbox.

## Deploy

1. Migrações 029 (tenant CAHU) e 003 (controle) via `psql` por arquivo no `.254`.
2. `credencial.json` em `C:\itau-cahu-pix\`, linha em `pagamento_provedores`, segredo do webhook em `integracao_credenciais`.
3. Registrar webhook no Itaú com o script.
4. Deploy API + retaguarda (git pull, build, restart-api.flag). APK novo com `qr_flutter`.
5. Atenção ao estado do git: main local está à frente 1 e atrás 22 de origin/main, e o servidor roda detached em b2a4268. Sincronizar antes de implementar.
