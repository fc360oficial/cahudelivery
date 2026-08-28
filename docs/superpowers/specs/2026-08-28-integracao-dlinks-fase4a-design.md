# Fase 4a — Outbound de pedidos + autenticação inbound (Dlinks)

## Contexto

O Fluxo Commerce vai integrar de verdade com o ERP da CAHU (Dlinks) na Fase 4.
O documento `01 - Documentação/02-INTEGRACAO-ERP.md` (seção 6) mapeia 11 endpoints
inbound (Dlinks → nós) e 3 outbound (nós → Dlinks), baseado no padrão observado em
outra integração já existente do Dlinks (usado só como referência interna, nunca
citado externamente).

Das 5 perguntas bloqueantes enviadas ao Dlinks em 06/08/2026, todas as 5 já foram
respondidas (confirmado pelo Tiago em 27-28/08/2026):
1. CAHU Delivery terá tenant/apikey própria, endpoints do documento, nos dois sentidos.
2. Existe endpoint de criação de cliente novo (CAHU Delivery → Dlinks).
3. Existe ambiente de homologação com produtos de teste.
4. Payload sempre completo (sem paginação/incremental).
5. Não se aplica — CAHU Distribuidora só tem 1 filial.

**Ainda não temos a especificação técnica de campo do Dlinks** (só confirmação de que
os endpoints existem/existirão) — este projeto constrói contra o formato de
referência documentado na seção 6, isolando os nomes de campo específicos do Dlinks
numa camada fina, para que o ajuste quando a doc real chegar seja barato.

## Escopo desta fase (4a)

Dado o tamanho total da Fase 4 (11 endpoints inbound + 3 outbound, cobrindo
catálogo, clientes, pagamento e status), o projeto foi decomposto em sub-fases.
Esta spec cobre só a **4a — a única parte cujo contrato é 100% nosso** (não depende
de nenhuma confirmação futura de campo do Dlinks):

- Middleware de autenticação inbound (apikey → tenant)
- `GET /integracoes/dlinks/pedidos` (Dlinks consulta pedidos)
- `POST /integracoes/dlinks/pedidos/recebido`
- `POST /integracoes/dlinks/pedidos/cancelado`

Fora de escopo aqui (sub-fases futuras, cada uma com sua própria spec): catálogo
inbound (4b), clientes/crédito inbound (4c), pagamento inbound (4d), status de
pedido inbound via `/pedidos-faturados` (4e).

## Arquitetura

### 1. Autenticação — apikey resolve o tenant

Hoje toda rota resolve o tenant pelo header `X-Tenant` (enviado pelo nosso próprio
app/retaguarda). As rotas desta fase são chamadas pelo Dlinks, que não conhece esse
conceito — só envia o header `apikey`.

**Nova tabela `integracao_credenciais`** (banco de controle `fluxo_control`, mesmo
padrão de `tenant_bancos`/`tenant_temas`):

```sql
create table integracao_credenciais (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  adaptador     text not null default 'dlinks',
  apikey_hash   text not null unique,   -- sha256 hex da apikey em texto puro
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);
```

**Novo middleware `DlinksAuthMiddleware`**, aplicado só em `/integracoes/dlinks/*`:
lê o header `apikey`, calcula `sha256(apikey)`, busca em `integracao_credenciais`
(banco de controle). Não encontrado ou `ativo = false` → `401`. Encontrado → resolve
`tenant_id` → `slug` → popula o mesmo `AsyncLocalStorage` que `tenantCtx()` já usa
(via `runComTenant`), então o resto do código (controllers, services) não muda nada.

Cadastro da apikey: manual, direto no banco de controle (via script), já que só
existe 1 tenant hoje — sem tela de retaguarda para isso nesta fase (YAGNI; criar
quando houver 2º cliente Fluxo Commerce).

### 2. Pedido muda de "empurrado" para "consultado"

Hoje o `OutboxWorker.processarOutbox()` **empurra** o pedido chamando
`adapter.enviarPedido()` e espera um `erpPedidoId` de volta na hora, gravando
`status = 'ENVIADO_ERP'` imediatamente. O Dlinks funciona ao contrário: ele consulta
pedidos pendentes quando quiser e confirma o que pegou depois.

**Nova capacidade no contrato** (`packages/erp-adapters/src/contrato.ts`):

```typescript
export interface ErpCapacidades {
  suportaWebhook: boolean;
  suportaPrecoPorCliente: boolean;
  suportaPix: boolean;
  suportaBoleto: boolean;
  suportaSyncIncremental: boolean;
  suportaPull: boolean; // novo — true = ERP consulta pedidos, não recebe push
}
```

`OutboxWorker.processarOutbox()`: quando `adapter.capacidades.suportaPull` for
`true`, não chama `enviarPedido()` — só marca o evento da outbox como processado
(`processado_em = now()`) sem alterar o status do pedido. O pedido fica em
`RECEBIDO`, visível para o `GET /pedidos`, até o Dlinks confirmar via `/recebido`.

O adaptador mock continua exatamente como está (push síncrono) — `suportaPull:
false` nele, nenhuma mudança de comportamento para ele.

### 3. Os 3 endpoints

Todos sob `/integracoes/dlinks/*`, protegidos pelo `DlinksAuthMiddleware`.

**`GET /integracoes/dlinks/pedidos?data_inicial=YYYY-MM-DD&data_final=YYYY-MM-DD`**

Retorna todos os pedidos criados no período, **qualquer status** (não filtra pelos
"ainda não confirmados" — quem decide o que já processou é o Dlinks, evitamos
adivinhar o comportamento de retry/dedup deles). Payload completo, sem paginação:

```json
{
  "pedidos": [
    {
      "codigo": "3f2a...-uuid-do-pedido",
      "criadoEm": "2026-08-28T14:00:00Z",
      "cliente": { "documento": "...", "erpClienteId": "..." },
      "tipoEntrega": "entrega",
      "endereco": { "logradouro": "...", "numero": "...", "cidade": "...", "uf": "...", "cep": "..." },
      "formaPagamento": "boleto",
      "condicaoPagamento": "30 dias",
      "itens": [{ "erpProdutoId": "...", "quantidade": 2, "precoUnit": 12.5 }],
      "valorAbatidoSaldo": 0
    }
  ]
}
```

`codigo` é o próprio `pedidos.id` (uuid) — sem gerar um código separado.

**`POST /integracoes/dlinks/pedidos/recebido`** — body `{ "codigos": ["uuid", ...] }`

Para cada código: se o pedido existe e está em `RECEBIDO`, transiciona para
`ENVIADO_ERP`, grava `pedido_eventos` (origem `'erp'`) e loga em `integracao_logs`.
Códigos não encontrados ou em status incompatível entram na resposta como
`ignorados` (não bloqueia os demais):

```json
{ "processados": ["uuid1"], "ignorados": [{ "codigo": "uuid2", "motivo": "nao_encontrado" }] }
```

**`POST /integracoes/dlinks/pedidos/cancelado`** — mesmo formato de entrada/saída.

Regra de negócio: só permite cancelar enquanto o pedido não chegou em `ENTREGUE`
(pedido entregue não pode ser cancelado retroativamente). Tentativa nesse caso entra
em `ignorados` com motivo `status_invalido`.

## Testes

Seguindo o padrão do resto do projeto: curl real contra API + Postgres locais.

- Autenticação: apikey válida resolve tenant certo; inválida/ausente → 401; apikey
  de tenant desativado → 401.
- `GET /pedidos`: pedido criado no período aparece com todos os campos; fora do
  período não aparece; múltiplos status aparecem (não só RECEBIDO).
- `POST /recebido`: pedido RECEBIDO vira ENVIADO_ERP; código inexistente cai em
  `ignorados` sem quebrar os outros; chamar duas vezes com o mesmo código é
  idempotente (segunda vez cai em `ignorados` por status incompatível, sem erro).
- `POST /cancelado`: mesmo padrão; pedido ENTREGUE não pode ser cancelado.
- `OutboxWorker`: com um adapter `suportaPull: true` de teste, pedido criado não
  soma tentativa de `enviarPedido()` (nenhuma chamada), fica em RECEBIDO, outbox
  marca processado.

## Fora de escopo (fica para sub-fases futuras)

- Sincronização de catálogo, clientes, formas de pagamento (4b/4c/4d) — dependem de
  confirmação de campo do Dlinks.
- `/pedidos-faturados` inbound (4e) — vai substituir o polling de status hoje feito
  por `OutboxWorker.sincronizarStatus()`.
- Tela de retaguarda para gerenciar apikeys — criar quando houver 2º cliente.
