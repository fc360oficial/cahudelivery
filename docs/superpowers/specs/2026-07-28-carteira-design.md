# Carteira (saldo) na Conta — Design

## Contexto

7º item do benchmark com o concorrente Praso: "Carteira Praso" mostra "Saldo na carteira:
R$0,00" com ícone de carteira e um extrato ("Suas movimentações aparecerão aqui"). Diferente das
duas features anteriores (Notas Fiscais, Crédito — só leitura/fila manual), o Tiago decidiu que
o saldo já pode ser usado como forma de pagamento no checkout (parcial, misturado com PIX/boleto)
nesta primeira versão.

## Decisões confirmadas com o Tiago

- Saldo é alimentado **manualmente pela retaguarda** (ex.: devolução, ajuste) — não vem do Dlinks
  nem é calculado automaticamente.
- Saldo pode ser usado no checkout de forma **parcial** (cobre uma parte do pedido, o resto
  continua indo por PIX/boleto) — não só quando cobre o pedido inteiro.
- Aceito o risco de mexer no contrato `ErpAdapter`/`PedidoParaErp` (pacote `@fluxo/erp-adapters`)
  pra viabilizar isso — sabendo que a Fase 4 (integração Dlinks) pode exigir revisão desse
  contrato de qualquer forma (já é um contrato provisório, ver achado de 16/07 na memória do
  projeto: o Dlinks empurra dado via POST, não puxa como o contrato atual assume).
- Estorno automático de saldo em pedido cancelado fica **fora de escopo** — não existe hoje
  nenhum fluxo de cancelamento de pedido disparado por código (só existe como valor possível do
  `status` no banco).

## Arquitetura

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
create table carteira_movimentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  valor numeric not null,              -- positivo = crédito, negativo = débito (uso)
  motivo text not null,
  pedido_id uuid references pedidos(id),  -- preenchido só quando o movimento é uso em pedido
  criado_por uuid references usuarios_admin(id), -- preenchido só quando é lançamento manual do admin
  criado_em timestamptz not null default now()
);
```

Sem coluna de "saldo" redundante — o saldo é sempre `sum(valor)` dos movimentos do cliente.
Mesma migração adiciona a coluna nova em `pedidos`:

```sql
alter table pedidos add column valor_saldo_usado numeric not null default 0;
```

### 2. Backend — cliente (`apps/api/src/profile/profile.controller.ts`, mesmo padrão SQL cru)

- `GET /v1/carteira` → `{ saldo: number, movimentos: Array<{id, valor, motivo, criado_em}> }`
  (`sum(valor)` + lista ordenada por `criado_em desc`, limit 50 — mesmo limite de
  `notificacoes`).

### 3. Backend — admin (`apps/api/src/admin/admin.controller.ts` +
`apps/api/src/admin/admin.service.ts`, mesmo padrão de `clientes`)

- `GET /admin/clientes/:id/carteira` → `{ saldo, movimentos }` (mesmo shape do endpoint do
  cliente, mas com `id` do cliente vindo da URL, não do JWT — é o admin consultando qualquer
  cliente).
- `POST /admin/clientes/:id/carteira` → body `{ valor: number, motivo: string }` (valor pode ser
  negativo, pra ajuste manual pra baixo), insere o movimento com `criado_por = usuarioId` do
  admin autenticado, grava em `auditoria` (`acao: 'lancar_movimento_carteira'`), retorna
  `{ ok: true }`.

### 4. Backend — uso no checkout (`apps/api/src/orders/orders.service.ts`,
`apps/api/src/orders/orders.controller.ts`)

`CriarPedidoDto` ganha `@IsOptional() @IsBoolean() usarSaldo?: boolean`. Em `criarPedido`,
dentro da mesma transação que já existe:

1. `select pg_advisory_xact_lock(hashtext($1))` com `cliente_id` — serializa qualquer outro
   pedido concorrente do mesmo cliente que também tente usar saldo (libera sozinho no
   commit/rollback).
2. `select coalesce(sum(valor),0) as saldo from carteira_movimentos where cliente_id = $1`.
3. `valorSaldoUsado = dto.usarSaldo ? Math.min(saldo, subtotal) : 0` (calculado no backend,
   nunca aceito como número vindo do app — evita manipulação).
4. Insere o pedido já com `valor_saldo_usado`.
5. Se `valorSaldoUsado > 0`, insere o movimento de débito:
   `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1, -$2,
   'Uso no pedido #' || $3, $4)`.
6. Envia `valorAbatidoSaldo: valorSaldoUsado` (se > 0) dentro do `PedidoParaErp` passado pro
   `enviarPedido` do outbox worker.

### 5. Pacote `@fluxo/erp-adapters` (`packages/erp-adapters/src/contrato.ts` +
`packages/erp-adapters/src/mock/mock-adapter.ts`)

`PedidoParaErp` ganha o campo opcional `valorAbatidoSaldo?: number`. O `DevMockAdapter` guarda
esse valor junto do resto do pedido (mesmo `Map` que já usa) e, em `obterCobranca`, calcula
`valor = max(0, itensTotal - (valorAbatidoSaldo ?? 0))` em vez de só somar os itens. Quando
`valor` chega a `0`, a cobrança ainda é criada (registro histórico), só que sem
`linhaDigitavel`/`pixCopiaCola` — o app já trata esses campos como opcionais no card de cobrança
(`if (c['pdf_url'] != null)` etc.), então uma cobrança de R$0,00 sem código de pagamento
renderiza de forma inofensiva (mostra só o valor, sem botão de ação).

### 6. App Flutter — tela `CarteiraScreen`
(`apps/mobile/lib/features/profile/carteira_screen.dart`)

Mesmo esqueleto de `NotificacoesScreen`/`CreditoScreen`: `GET /carteira` no `initState`, estado
de carregando/erro/conteúdo. Conteúdo: card com "Saldo na carteira: R$X" (ícone de carteira) +
lista de movimentos (`Card` por item: valor com sinal — verde se positivo, vermelho se
negativo —, motivo, data) ou `EstadoVazio` ("Suas movimentações aparecerão aqui") se a lista
vier vazia. Item de menu em `PerfilScreen`, entre "Crédito" e "Sobre o app".

### 7. App Flutter — checkout (`apps/mobile/lib/features/checkout/checkout_screen.dart`)

No passo de pagamento: busca `GET /carteira` (novo `_saldo` no state, carregado no `initState`
do checkout junto dos endereços). Se `_saldo > 0`, mostra um `CheckboxListTile` "Usar meu saldo
(R$X disponível)" acima da escolha de PIX/boleto. Quando marcado, mostra abaixo o texto
"R$Y serão abatidos do saldo · restam R$Z para pagar" (`Y = min(saldo, subtotal)`, `Z = subtotal
- Y`, calculados no app só pra exibição — o valor que vale é sempre recalculado no backend). Ao
confirmar, `POST /pedidos` ganha `'usarSaldo': _usarSaldo` no body. PIX/boleto continuam sendo
escolhidos normalmente, mesmo quando `Z = 0`.

### 8. Retaguarda — página `Carteira.tsx` (`apps/admin/src/paginas/Carteira.tsx`)

Busca de cliente por nome/CNPJ/CPF (reaproveita o padrão de busca de `Clientes.tsx`, com
`useSearchParams`). Ao selecionar um cliente da busca, mostra card de saldo + extrato (mesmo
formato do app) e um formulário pequeno (valor + motivo) pra lançar um movimento novo — recarrega
o extrato depois de lançar. Rota `/carteira` e link `💰 Carteira` no menu lateral, entre
"Crédito" e "Produtos".

## Fora de escopo

- Estorno automático de saldo em pedido cancelado (ver "Decisões confirmadas" acima).
- Editar/excluir um movimento já lançado — só lançamento novo (se o admin errar o valor, lança um
  segundo movimento de ajuste, mesma lógica de estorno manual).
- Notificar o cliente quando um movimento é lançado — mesmo padrão do Crédito, sem push/inbox por
  enquanto.
- Limite de quanto saldo negativo um cliente pode ter — o admin pode lançar um valor negativo
  maior que o saldo atual (fica negativo) porque isso é decisão administrativa, não uma regra do
  sistema; o checkout, por outro lado, nunca deixa `valorSaldoUsado` exceder o saldo disponível
  (`Math.min`).