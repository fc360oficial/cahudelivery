# Desconto Progressivo por Quantidade — Design

## Contexto

Continuação do benchmark com o app concorrente "Praso" (23/07/2026). Depois de entregar as Vitrines Patrocinadas, o próximo item priorizado pelo Tiago foi o desconto progressivo por quantidade — no Praso aparece como o selo "Leve + Pague -" / "a partir da 4ª un", "a partir da 12ª un" etc., onde o preço unitário cai quando o cliente leva mais.

## Requisitos confirmados com o Tiago

- Conta por **caixa/fardo comprado**, não por unidade avulsa dentro do pacote — bate com o modelo de venda B2B da CAHU (majoritariamente por pacote fechado).
- **Um único nível** por produto: preço normal até N-1 caixas/fardos, preço com desconto a partir de N.
- Configurado por produto na retaguarda (hoje a tela "Produtos" é só leitura — preço vem do ERP; os dois campos novos são exclusivos do CAHU Delivery, não sincronizam com o ERP).
- Selo informativo no card do produto (preço normal + "a partir de N un: R$X"), preço de verdade só muda quando a quantidade no carrinho bate o mínimo.
- Precedência com promoção: **sempre o menor preço entre os dois** — nunca cobra mais que o melhor desconto disponível pro cliente.

## Arquitetura

Reaproveita a descoberta de que o preço do carrinho (`OrdersService.carrinho()`, `apps/api/src/orders/orders.service.ts:24-46`) já é recalculado ao vivo via SQL, já joinado com `carrinho_itens.quantidade` — não precisa mudar a arquitetura de carrinho/pedido, só estender a fórmula de preço existente. `criarPedido()` (linha 85) reaproveita `carrinho()`, então o preço já sai certo no fechamento automaticamente.

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
alter table produtos add column if not exists desconto_qtd_minima int;
alter table produtos add column if not exists desconto_qtd_preco numeric;
```

Sem tabela nova — é uma relação 1:1 com o produto (só 1 nível), consistente com `qtd_minima`/`qtd_por_embalagem` já serem colunas diretas de `produtos`.

### 2. Preço no carrinho (`apps/api/src/orders/orders.service.ts`, método `carrinho`)

A expressão de preço atual passa de:
```sql
coalesce(promo.preco_promocional, pr.preco) as preco_atual
```
para (menor valor entre tabela, promoção vigente, e desconto por quantidade quando a quantidade do item bate o mínimo):
```sql
least(
  coalesce(promo.preco_promocional, pr.preco),
  case when p.desconto_qtd_minima is not null and ci.quantidade >= p.desconto_qtd_minima
       then p.desconto_qtd_preco else pr.preco end
) as preco_atual
```
(`p` já está joinado na query; `desconto_qtd_minima`/`desconto_qtd_preco` vêm da tabela `produtos` sem join novo.)

### 3. API pública — catálogo (`SELECT_PRODUTO` em `apps/api/src/catalog/catalog.service.ts`)

Adiciona `p.desconto_qtd_minima`, `p.desconto_qtd_preco` como colunas no `select` — só pra exibição do selo (não muda o `preco` retornado, que continua quantidade-independente nas vitrines/listas).

### 4. API admin — editar produto (`apps/api/src/admin/admin-catalogo.controller.ts` ou novo `admin-produtos.controller.ts`)

Novo endpoint `PATCH /admin/produtos/:id/desconto-qtd` — recebe `{ descontoQtdMinima?: number, descontoQtdPreco?: number }` (ambos `null`/ausentes remove o desconto), UPDATE direto em `produtos`.

### 5. Retaguarda (`apps/admin/src/paginas/Produtos.tsx`)

Duas colunas novas na tabela ("A partir de" e "Preço c/ desconto"), editáveis inline (input numérico direto na célula + botão salvar por linha — a tela hoje não tem nenhuma edição, então é a primeira; segue o padrão de botão `btn-mini` já usado nas outras telas).

### 6. App Flutter (`apps/mobile/lib/widgets/produto_card.dart`)

Selo verde abaixo do preço quando `desconto_qtd_minima` não é nulo: "a partir de {N} un: {preço}" — mesmo estilo visual do selo "OFERTA" já existente (cor diferente pra não confundir com promoção). Preço principal do card continua o mesmo de hoje (`preco`, quantidade-independente) — o preço de verdade só reflete no carrinho, que já busca o valor atualizado do servidor a cada mudança de quantidade (fluxo existente, sem mudança necessária).

## Fora de escopo

- Múltiplos níveis de desconto por produto (só 1 nível, confirmado com o Tiago).
- Desconto por unidade avulsa dentro do pacote (só por caixa/fardo).
- Sincronização desses dois campos com o ERP — são exclusivos do CAHU Delivery.