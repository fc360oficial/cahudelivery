# Vencimento Próximo — Design

## Contexto

4º item do benchmark com o app concorrente "Praso" (após Vitrines Patrocinadas, Desconto
Progressivo por Quantidade e Selo de Estoque Baixo, todos entregues em 23-24/07/2026): seção
"Vencimento Próximo" mostrando produtos perto da data de validade, com selo "Val. DD/MM" no card.

## Requisitos confirmados com o Tiago

- Validade **por produto, uma data só** (não por lote) — mesmo padrão simples das 3 features
  anteriores. Editado manualmente na retaguarda (campo exclusivo do CAHU Delivery, não sincroniza
  com o ERP, mesma lógica do desconto por quantidade e do limite de estoque baixo).
- Limite de "quantos dias antes de vencer conta como próximo" configurável globalmente em
  Configurações (mesmo padrão do limite de estoque baixo) — `0` ou ausente desativa a seção.

## Arquitetura

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
alter table produtos add column if not exists data_validade date;
```

### 2. Configuração global (`apps/api/src/admin/admin-config.controller.ts`)

Adiciona `dias_vencimento_proximo` à lista `CHAVES_PERMITIDAS` — reaproveita o CRUD genérico de
`GET/PATCH /admin/configuracoes` já existente, sem endpoint novo.

### 3. Backend admin — editar validade do produto (`apps/api/src/admin/admin.controller.ts` /
   `admin.service.ts`)

Novo endpoint `PATCH /admin/produtos/:id/validade` — recebe `{ dataValidade?: string | null }`
(formato `YYYY-MM-DD`, `null`/ausente remove a validade), mesmo padrão de `alternarProduto` e
`descontoQtdProduto` já existentes (UPDATE direto + registro em `auditoria`).

### 4. API pública (`apps/api/src/catalog/catalog.service.ts`)

- `SELECT_PRODUTO` ganha `p.data_validade` na lista de colunas (exibição do selo).
- `home()` ganha mais uma consulta paralela, no mesmo padrão de `promocoes`/`maisVendidos`:
  produtos com `data_validade` entre hoje e hoje + `dias_vencimento_proximo` (lidas de
  `configuracoes`), ordenados pela validade mais próxima primeiro. Retorna como
  `vencimentoProximo` no JSON de `/v1/home`, ao lado de `promocoes`/`maisVendidos`/`prateleiras`.
  Se `dias_vencimento_proximo` for `0`/ausente, a consulta não roda (array vazio) — sem mudança de
  comportamento pra quem não configurou.

### 5. Retaguarda

- `Configuracoes.tsx`: novo campo "Vencimento próximo em quantos dias" (número), mesmo padrão do
  campo "Estoque baixo".
- `Produtos.tsx`: nova coluna "Validade" com um `<input type="date">` editável inline por produto
  (mesmo padrão de edição inline já usado pra desconto por quantidade — adicionar/editar/remover).

### 6. App Flutter (`apps/mobile/lib/features/home/home_screen.dart`,
   `apps/mobile/lib/widgets/produto_card.dart`)

- `home_screen.dart`: mais uma chamada a `_vitrine(...)` (o helper que já existe e já é usado por
  "Promoções"/"Mais vendidos") logo depois de "Mais vendidos", usando `_home!['vencimentoProximo']`
  — nenhum widget novo necessário.
- `produto_card.dart`: selo "Val. DD/MM" (formatando `produto['data_validade']`) quando o campo não
  é nulo — mesmo padrão visual dos selos de desconto/estoque já adicionados hoje.

## Fora de escopo

- Validade por lote (múltiplas datas por produto) — confirmado: só uma data por produto.
- Sincronização da validade com o ERP — campo exclusivo do CAHU Delivery.
