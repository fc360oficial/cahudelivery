# Vitrines Patrocinadas — Design

## Contexto

Benchmark com o app concorrente "Praso" (23/07/2026, pedido do diretor da CAHU) mostrou vitrines
patrocinadas por indústria/fabricante (ex.: "Parceiros Praso": Nestlé, Heineken, Piracanjuba, L'Or) —
um carrossel de produtos com banner e logo próprios, misturado entre as prateleiras de categoria na
tela de Início. É a primeira funcionalidade de monetização do CAHU Delivery: hoje não existe nenhum
patrocinador cadastrado (0), e a ideia é ativar incrementalmente conforme negociações comerciais forem
fechadas (1 fornecedor, depois 2, e assim por diante).

## Requisitos confirmados com o Tiago

- Um "patrocinador" **não é o mesmo conceito que `marca`** no catálogo. Uma indústria pode incluir
  produtos de várias marcas dela (ex.: M.Dias inclui tudo da Vitarella e pode adicionar outra marca
  própria depois). Por isso não modelamos hierarquia "fabricante → marcas" — o patrocinador é uma
  vitrine com **produtos escolhidos manualmente**, igual ao padrão já usado em "Promoções".
- Gerenciado 100% pela retaguarda: criar patrocinador, adicionar/remover produtos, definir preço
  especial opcional por produto (se não definir, usa o preço normal da tabela).
- Visual igual ao Praso: banner de imagem (tipo anúncio) + logo redondo + nome + "Ver todos" +
  carrossel de produtos.
- Posicionamento: cada patrocinador é configurado para aparecer **depois de uma categoria específica**
  escolhida na retaguarda (ex.: "depois de Bebidas"), ou "no topo, antes de tudo". Sem número de ordem
  manual — mais simples pro Tiago operar.
- Com 0 patrocinadores ativos, a tela de Início fica idêntica à atual (nenhuma mudança visível).

## Arquitetura

Segue exatamente os padrões já estabelecidos no projeto (ver `admin-catalogo.controller.ts`,
tabelas `promocoes`/`promocao_produtos`/`banners`): NestJS com SQL cru via `tenantCtx().pool`,
DTOs com `class-validator`, banco PostgreSQL multi-tenant (uma migração numerada em `infra/sql/tenant`),
retaguarda React reaproveitando o padrão de tela de "Promoções", app Flutter reaproveitando o
widget `produto_card`.

### 1. Banco de dados (migração nova em `infra/sql/tenant`, espelhar em `11 - SQL`)

```sql
create table patrocinadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text,
  banner_url text,
  apos_categoria_id uuid references categorias(id), -- null = topo, antes de tudo
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table patrocinador_produtos (
  patrocinador_id uuid not null references patrocinadores(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  preco_especial numeric, -- opcional; null = usa preço normal da tabela padrão
  ordem int not null default 0, -- ordem dentro do carrossel do próprio patrocinador
  primary key (patrocinador_id, produto_id)
);
```

### 2. API — `admin-catalogo.controller.ts` (ou novo `admin-patrocinadores.controller.ts` se o arquivo
   crescer demais)

- `GET /admin/patrocinadores` — lista com produtos agregados (`json_agg`, mesmo padrão de `promocoes`)
- `POST /admin/patrocinadores` — cria (nome, logoUrl, bannerUrl, aposCategoriaId, produtos[])
- `PUT /admin/patrocinadores/:id` — edita; substitui a lista de produtos inteira (mesmo padrão de
  `editarPromocao`: delete + re-insert dentro de uma transação)
- `DELETE /admin/patrocinadores/:id` — remove
- Reaproveita `GET /admin/produtos-busca` já existente pro seletor de produtos na retaguarda

### 3. API pública — `catalog.controller.ts` / `catalog.service.ts`

`GET /v1/home` (usado pelo app) passa a incluir os patrocinadores ativos, cada um com seus produtos
(preço especial já resolvido), montados na sequência certa: para cada categoria/prateleira renderizada,
depois de renderizá-la checa se algum patrocinador ativo tem `apos_categoria_id` igual a essa categoria
e injeta a vitrine dele ali; patrocinadores com `apos_categoria_id` nulo entram no topo, antes de tudo.

Formato de cada item de vitrine no JSON de resposta:
```json
{
  "tipo": "patrocinador",
  "id": "...",
  "nome": "...",
  "logoUrl": "...",
  "bannerUrl": "...",
  "produtos": [ /* mesmo shape de produto usado no resto do home */ ]
}
```

### 4. Retaguarda (React)

Tela nova "Patrocinadores" no menu, no mesmo padrão visual da tela "Promoções" já existente:
- Formulário: nome, upload de logo (reaproveita `POST /admin/upload` já existente), upload de banner,
  select "aparece depois de" (lista de categorias + opção "topo"), toggle ativo
- Busca e adiciona produtos (reaproveita o componente de busca já usado em Promoções/Banners), com
  campo opcional de preço especial por produto adicionado
- Lista de patrocinadores com editar/ativar-desativar/remover

### 5. App (Flutter)

Componente novo `vitrine_patrocinada.dart` em `lib/widgets`:
- Banner de imagem (largura total, mesma proporção 3.5:1 já usada nos banners de home)
- Logo redondo + nome do patrocinador + link "Ver todos"
- Carrossel horizontal reaproveitando `produto_card` existente
- "Ver todos" abre uma tela de lista completa dos produtos daquele patrocinador (dados já vêm
  embutidos na resposta do `/v1/home` — sem endpoint novo necessário, já que o volume esperado de
  produtos por patrocinador é pequeno)

`HomeScreen` passa a percorrer a lista combinada (categorias + vitrines patrocinadas) na ordem que a
API já devolve, sem lógica de ordenação no cliente.

## Fora de escopo (por enquanto)

- Vitrine patrocinada por tempo determinado (início/fim como em Promoções) — hoje é só ativo/inativo;
  se precisar de data de expiração de contrato, adicionar depois (campos `inicio_em`/`fim_em` como já
  existe em Promoções e Banners, é um acréscimo simples de migração).
- "Foto do estoque" do Praso — propósito não identificado, não faz parte desta spec.
- As outras 5 funcionalidades do benchmark Praso (desconto progressivo por quantidade, selo de
  urgência de estoque, "Vencimento Próximo", Notas Fiscais dedicada, indicação/referral) — cada uma
  terá sua própria spec quando priorizada.