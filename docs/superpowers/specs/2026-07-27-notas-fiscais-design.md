# Notas Fiscais na Conta — Design

## Contexto

5º item do benchmark com o concorrente Praso (23/07/2026): o Praso tem "Notas Fiscais" como
lista dedicada na aba Conta. Hoje o CAHU Delivery só mostra a NF dentro do detalhe de cada
pedido (`pedido_detalhe_screen.dart`, card "Nota fiscal" — número, data de emissão, chave de
acesso copiável, botão "Abrir DANFE (PDF)"). Não existe endpoint nem tela que liste NFs de
múltiplos pedidos de uma vez.

## Decisões confirmadas com o Tiago

- **Toque na linha:** vai pro detalhe do pedido (reaproveita a tela/card que já existe).
- **Escopo da lista:** só pedidos que já têm NF emitida — não lista pedido sem NF, sem selo de
  "pendente".
- **Paginação:** scroll infinito, mesmo padrão da aba Pedidos (20 por página).
- **Atalho de PDF:** cada linha tem um ícone que abre o PDF direto, sem precisar entrar no
  pedido.

## Arquitetura

### 1. Backend — endpoint novo (`apps/api/src/orders/orders.service.ts` + `orders.controller.ts`)

`GET /v1/pedidos/notas?pagina=N` — mesmo formato de resposta de `GET /v1/pedidos`
(`{ dados: [...], pagina: N }`), mas com `inner join pedido_notas` (só pedidos que já têm NF) e
ordenado por `emitida_em desc` (data de emissão da nota, não de criação do pedido — mais
correto pra uma listagem de NFs: a nota mais recente aparece primeiro mesmo que o pedido seja
mais antigo que outro faturado depois).

```sql
select p.id as pedido_id, p.numero, p.total,
       n.numero_nf, n.chave_acesso, n.pdf_url, n.emitida_em
  from pedidos p
  join pedido_notas n on n.pedido_id = p.id
 where p.cliente_id = $1
 order by n.emitida_em desc
 limit 20 offset $2
```

**Atenção de implementação:** o `OrdersController` já tem `@Get('pedidos/:id')` registrado
(`orders.controller.ts:81`). Rotas no NestJS casam na ordem de declaração dentro do
controller — o novo `@Get('pedidos/notas')` **precisa ser declarado antes** de
`@Get('pedidos/:id')`, senão `/v1/pedidos/notas` seria interpretado como
`/v1/pedidos/:id` com `id = "notas"` (e cairia num erro de UUID inválido).

Service reaproveita o mesmo padrão de `listar()` (`orders.service.ts:153-161`): paginação por
`limit 20 offset (pagina-1)*20`, retorno `{ dados: rows, pagina }`.

### 2. App Flutter — tela nova `NotasFiscaisScreen`

Novo arquivo `apps/mobile/lib/features/profile/notas_fiscais_screen.dart`, mesmo esqueleto de
`PedidosScreen` (`apps/mobile/lib/features/orders/pedidos_screen.dart`): `ScrollController`
com paginação (limite 20, carrega mais a 300px do fim), skeleton enquanto carrega a 1ª página,
`EstadoVazio` se a lista vier vazia, `EstadoErro` com "tentar novamente", `RefreshIndicator`
pra puxar e atualizar.

Cada linha (`Card` + `ListTile`, mesmo visual da lista de Pedidos):
- Título: "NF-e nº {numero_nf}" + valor do pedido (`moeda(total)`) alinhado à direita.
- Subtítulo: data de emissão (`dataCurta(emitida_em)`) + "Pedido nº {numero}".
- Trailing: ícone de PDF (`Icons.picture_as_pdf_outlined`) que chama `_abrirUrl(pdf_url)` via
  `url_launcher` (mesmo helper já usado em `pedido_detalhe_screen.dart:56-61` — código
  duplicado aqui, é uma função de 5 linhas, não vale extrair pra um helper compartilhado só por
  isso). Se `pdf_url` for nulo (nota emitida mas PDF ainda não sincronizado), o ícone fica
  desabilitado/oculto — nunca abre um link vazio.
- Toque no restante da linha (fora do ícone de PDF): navega pra
  `PedidoDetalheScreen(pedidoId: pedido_id)`.

**Estado vazio:** "Nenhuma nota fiscal ainda" / "Suas notas fiscais aparecem aqui assim que a
distribuidora faturar seus pedidos."

### 3. Menu em Perfil (`apps/mobile/lib/features/profile/perfil_screen.dart`)

Novo item `_opcao(Icons.description_outlined, 'Notas fiscais', ...)` no mesmo `Card` de
"Dados cadastrais" / "Endereços de entrega" / "Notificações" / "Sobre o app"
(`perfil_screen.dart:176-201`), posicionado entre "Notificações" e "Sobre o app" (mesma ordem
de importância dos outros itens de conta). Navega pra `NotasFiscaisScreen` via
`Navigator.push`, sem retorno esperado (não muda nada no perfil).

## Fora de escopo

- Filtro/busca por número de NF ou período — lista simples por enquanto, sem barra de busca.
- Download/compartilhamento do XML da nota (`xml_url` já existe na tabela `pedido_notas` mas
  não é usado nem no detalhe do pedido hoje — só o PDF). Não mexer nisso agora.
- Contador de não lidas ou qualquer estado de "nova NF" — diferente de Notificações, NF não tem
  conceito de lida/não lida.