# Webhook de pagamento MaxiPago — receptor

**Data:** 22/09/2026
**Status:** aprovado

## Problema

A ficha de credenciamento da Rede (aba "Gateway de Pagamentos MaxiPago") exige, em
"Dados Técnicos", a URL de webhooks de produção — o endereço para onde a MaxiPago
devolve o callback assíncrono das transações. A API do CAHU Delivery não tem nenhum
endpoint de pagamento: hoje `forma_pagamento` é só um campo declarado no pedido
(`boleto`/`pix`/`cartao`), sem captura online.

A integração de verdade está bloqueada — depende do PV e.Rede e da chave de
integração (token e.Rede), que a Rede ainda não liberou. Sem isso não há como
conhecer o payload real nem testar ponta a ponta.

## Escopo

Criar **só o receptor**: uma rota que autentica a origem, grava o callback cru e
responde 200. Nada de baixa em pedido, mapa de status ou checkout.

Isso resolve o problema imediato (URL válida para a ficha) e monta a base certa:
quando a Rede liberar as credenciais, lemos os callbacks já gravados para descobrir
o formato real antes de escrever o processamento, em vez de chutar.

**Fora de escopo:** baixa automática do pedido, mapa de status MaxiPago→pedido,
checkout online no app, conciliação.

## Decisões

**URL e autenticação — segredo no caminho.** A MaxiPago chama de fora, sem
`X-Tenant` e sem header customizado, então o tenant precisa sair da própria URL.
Seguimos o padrão já existente do Dlinks: credencial por tenant em
`integracao_credenciais` (`adaptador = 'maxipago'`), guardada como hash sha256.
Quem conhece o segredo é o tenant; rotacionar é trocar a linha no banco, sem deploy.

```
POST /v1/integracoes/maxipago/<segredo>/webhook
```

O prefixo `/v1` é obrigatório: no Caddy do Servidor_BI só `/v1/*` e `/uploads/*`
chegam na API (`infra/caddy/cahudelivery.caddy`).

**Domínio.** Fica o DuckDNS (`cahudelivery.duckdns.org`) por decisão do Tiago —
mudar a URL depois exige chamado na Rede, risco aceito para não travar o envio
da ficha.

**Responde 200 sempre que conseguir gravar.** Gateway que recebe erro fica
reenviando o callback. Falha de parse não é erro: o corpo é gravado cru do mesmo
jeito. Só 401 (segredo inválido) e 500 (banco fora) saem com erro.

**Aceita JSON e XML.** Boa parte das APIs da MaxiPago é XML; como não temos a
documentação do callback em mãos, o endpoint grava o corpo como texto,
independentemente do `Content-Type`.

## Componentes

### 1. Migração `infra/sql/tenant/027_maxipago_webhook.sql`

Tabela `pagamento_webhooks` no schema do tenant:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | |
| `recebido_em` | timestamptz | default now() |
| `origem` | text | `'maxipago'` — a tabela serve qualquer gateway |
| `content_type` | text | como veio no header |
| `corpo_bruto` | text | payload cru, sem parse |
| `ip_origem` | text | para futura allowlist |
| `processado` | boolean | default false |
| `erro` | text | null por ora |

### 2. Módulo `apps/api/src/integracoes-maxipago`

- `maxipago-auth.middleware.ts` — lê o segredo do path, sha256, busca em
  `integracao_credenciais` com `adaptador = 'maxipago'` e `ativo = true`,
  resolve tenant e roda `runComTenant`. 401 quando não encontra.
- `maxipago.controller.ts` — `POST integracoes/maxipago/:segredo/webhook`,
  `@HttpCode(200)`.
- `maxipago.service.ts` — insere em `pagamento_webhooks` via `tenantCtx()`.
- `maxipago.module.ts` — aplica o middleware no controller.

Em `app.module.ts`, `integracoes/maxipago/(.*)` entra na exclusão do
`TenancyMiddleware`, igual ao Dlinks — o tenant vem do segredo, nunca do header.

### 3. `main.ts`

Habilitar o body parser de texto para `application/xml`, `text/xml` e
`text/plain`. Sem isso o corpo XML chega vazio no controller.

### 4. Registro da credencial

Script em `infra/scripts/maxipago-credencial.sql`: insere o hash do segredo
para o tenant `cahu`. O segredo em texto puro não fica no repositório.

## Testes

Spec do middleware (segredo válido resolve tenant; segredo inválido e ausente
dão 401) e do service (grava corpo cru e content-type).

## Verificação em produção

`curl -X POST` na URL real com um corpo qualquer deve devolver 200 e criar
uma linha em `pagamento_webhooks`; com segredo errado, 401.
