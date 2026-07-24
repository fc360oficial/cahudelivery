# Selo de Estoque Baixo — Design

## Contexto

3º item do benchmark com o app concorrente "Praso" (após Vitrines Patrocinadas e Desconto
Progressivo por Quantidade, ambos entregues em 23-24/07/2026): selo de urgência de estoque
("2 em estoque") pra incentivar decisão de compra mais rápida.

## Requisitos confirmados com o Tiago

- Limite configurável globalmente pra todo o catálogo (não por produto) — mesmo padrão do
  campo "Pedido mínimo" que já existe em Configurações.
- Cor/texto exato do selo: decidir depois de ver funcionando (placeholder inicial: laranja,
  texto "{N} em estoque").

## Arquitetura

Reaproveita 100% a infraestrutura de configuração já existente — sem migração de banco, sem
endpoint novo, sem chamada de rede nova no app.

### 1. Backend admin (`apps/api/src/admin/admin-config.controller.ts`)

Adiciona a chave `limite_estoque_baixo` à lista `CHAVES_PERMITIDAS` (linha 41). O CRUD de
`GET/PATCH /admin/configuracoes` já existente passa a aceitar essa chave automaticamente —
nenhuma outra mudança de backend necessária. Valor: `number` (quantidade), `0` ou ausente =
selo desativado.

### 2. Retaguarda (`apps/admin/src/paginas/Configuracoes.tsx`)

Novo card "Estoque baixo", mesmo padrão visual do card "Pedido mínimo" já existente (linhas
46-52): campo numérico, texto explicativo abaixo. Adiciona `limite_estoque_baixo?: number` à
interface `Config` (linha 4-9).

### 3. API pública (`apps/api/src/catalog/catalog.service.ts`, método `config()`)

Nenhuma mudança — `config()` já retorna todas as chaves de `configuracoes` via
`Object.fromEntries(cfg.rows.map(...))` (linha 59-64), então `limite_estoque_baixo` já sai
em `GET /v1/config` assim que existir na tabela.

### 4. App Flutter (`apps/mobile/lib/widgets/produto_card.dart`)

`TenantTheme.instance.configuracoes` já carrega todas as configurações no boot do app
(`tenant_theme.dart:33`) — nenhuma chamada de rede nova. No método `build` do `ProdutoCard`
(ou em `_blocoPreco`), lê `TenantTheme.instance.configuracoes['limite_estoque_baixo']` e
mostra o selo "{estoque} em estoque" (fundo laranja `Colors.orange.shade50`/texto
`Colors.orange.shade800`, cor a confirmar depois de rodar) quando:
`0 < estoque <= limite` (limite ausente ou `0` = selo nunca aparece; `estoque == 0` continua
mostrando "Sem estoque" como hoje, sem selo de urgência).

Posição do selo: no canto da imagem do produto (`Stack` já existente no `ProdutoCard`, mesmo
padrão do selo "OFERTA" atual) ou abaixo do preço (mesmo padrão dos selos de fardo/desconto
por quantidade) — usar o padrão do selo "OFERTA" (canto da imagem), por ser mais visível e
não competir por espaço com os outros selos de preço que já se acumulam ali.

## Fora de escopo

- Limite por produto (confirmado: só global).
- Cor/estilo definitivo do selo — ajustar depois de ver rodando.
