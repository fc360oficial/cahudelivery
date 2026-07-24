# Card estilo Praso + Favoritos — Design

## Contexto

Redesenho do `ProdutoCard` (usado em toda vitrine/grade do app) pra ficar parecido com o
concorrente Praso, a partir de print real trocado com o Tiago em 24/07/2026, mais a
funcionalidade de favoritar produtos que o print revelou (ícone de coração) — nova, não existe
hoje.

## Requisitos confirmados com o Tiago

- **Cor do preço:** preto por padrão; **verde quando o produto está em promoção** (com o "X%
  OFF" também verde, na mesma linha do preço riscado) — igual ao Praso.
- **Selo de validade:** continua vermelho.
- **Botão "+":** continua amarelo (cor do tenant), mas muda de posição — vai pra cima da foto.
- **Favoritar:** ícone de coração incluído agora, **salvo no servidor** por cliente (não só no
  aparelho) — sincroniza entre dispositivos.

## Arquitetura

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
create table favoritos (
  cliente_id uuid not null references clientes(id),
  produto_id uuid not null references produtos(id),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);
```

### 2. Backend (`apps/api/src/profile/profile.controller.ts`)

Reaproveita o mesmo controller que já cuida de perfil/endereços/dispositivos do cliente logado
(`JwtAuthGuard`, `ReqCliente`, sem service separado — segue o padrão já usado nesse arquivo,
SQL cru direto no controller):

- `GET /favoritos` → `select produto_id from favoritos where cliente_id = $1` → retorna array de
  ids (`string[]`).
- `POST /favoritos/:produtoId` → `insert ... on conflict do nothing`.
- `DELETE /favoritos/:produtoId` → `delete from favoritos where cliente_id = $1 and produto_id = $2`.

Sem mudança nas queries de catálogo (`SELECT_PRODUTO`, `/v1/home`, etc.) — o app busca a lista de
favoritos **uma vez** (no boot/login) e resolve localmente quais produtos estão favoritados,
mesmo padrão já usado pelo carrinho (`CarrinhoStore`).

### 3. App Flutter — `FavoritosStore` (novo, `apps/mobile/lib/core/favoritos_store.dart`)

Singleton `ChangeNotifier`, espelha `CarrinhoStore`:
- `Set<String> favoritados`
- `carregar()` — `GET /favoritos` (só se `ApiClient.instance.logado`; visitante fica com o Set
  vazio)
- `favoritado(String produtoId)` — leitura local, sem chamada de rede
- `alternar(String produtoId)` — `POST`/`DELETE` conforme o estado atual, atualiza o Set local e
  notifica
- Carregado no boot do app (mesmo lugar que hoje chama `CarrinhoStore`/`TenantTheme.carregar()`)
  e limpo no logout (mesmo lugar que `CarrinhoStore.limpar()`)

### 4. App Flutter — `ProdutoCard` redesenhado (`apps/mobile/lib/widgets/produto_card.dart`)

Remove a moldura/sombra do `Card` (visual mais plano). Estrutura nova:

**Foto (Stack):**
- Ícone de coração, canto superior direito — preenchido/vermelho se favoritado, contorno se não.
  Toque: se visitante, abre tela de login/cadastro (mesmo padrão do carrinho); se logado, chama
  `FavoritosStore.instance.alternar(produtoId)`.
- Selo branco de embalagem, canto inferior esquerdo (ex.: "CX c/12") — substitui o texto cinza
  que hoje fica entre o nome e o preço.
- Botão "+" (o `_BotaoAdicionar` que já existe), canto inferior direito, sobreposto na foto —
  sai de onde está hoje (do lado do preço).
- Remove o selo "OFERTA" (o desconto passa a ser comunicado só pela cor verde + "%" inline, como
  no Praso).

**Abaixo da foto (sem selo de embalagem aqui, foi pra cima):**
- Linha do preço: valor atual (`Colors.black87` normal / `Colors.green.shade700` se em
  promoção) +, se em promoção, um selo verde inline "`X`% OFF" (`X` calculado como
  `((precoTabela - precoAtual) / precoTabela * 100).round()`) + preço de tabela riscado ao lado.
- Preço do pacote/caixa em texto cinza pequeno (ex.: "R$72,63/cx") — mesmo texto de hoje, sem
  fundo colorido.
- Nome do produto (2 linhas, como hoje).
- Selo de desconto por quantidade (verde, já existe) → mantém.
- Selo de estoque baixo (laranja, já existe) → mantém.
- Selo de validade (vermelho, já existe) → mantém.

Sem card de card / sem `Card` widget — troca por `ClipRRect` + `Container` com
`BoxDecoration` simples (fundo branco, `borderRadius`), mantendo o clique (`InkWell`) no card
inteiro.

## Fora de escopo

- Tela dedicada "Meus favoritos" (lista separada) — só o ícone/estado no card por enquanto.
- Sincronizar favoritos de visitante pra conta ao logar (mesma lógica já existe pro carrinho
  anônimo, mas replicar isso aqui é trabalho novo — visitante simplesmente não vê favoritos até
  logar).
