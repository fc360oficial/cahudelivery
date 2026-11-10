# Fluxo Vendas — Retaguarda (Plano 3)

**Objetivo:** a retaguarda passa a ter entrada por solução. Depois do login o usuário cai no painel a que tem acesso: Delivery (o que existe hoje, sem redesenho) ou Vendas (novo). Vendas e Delivery não se enxergam.

**Base:** branch `fluxo-vendas-retaguarda`, em cima de `fluxo-vendas` (API do Plano 1) e de `login-fluxo-commerce` (login novo).

## Regras que valem para todas as tarefas

- Nenhuma tela do Delivery é redesenhada. No Delivery só muda o menu (saem Usuários e Integração ERP).
- Nada de dado fictício: toda tela de Vendas lê da API.
- O banco é um só; pedido de vendedor é `pedidos.origem = 'vendedor'`. Telas e números de Vendas consideram só esses pedidos; os do Delivery só `origem = 'app_cliente'` (já feito no Plano 1).
- Indicadores de venda de Vendas contam pedidos com `origem = 'vendedor'` e `status not in ('CANCELADO','AGUARDANDO_VENDEDOR')`. "Retido" é `status = 'AGUARDANDO_VENDEDOR'`. Datas no fuso `America/Recife`.
- Migrações só aditivas e repetíveis. Não tocar em `apps/mobile`.
- Visual de Vendas: menu azul-marinho `#0B1F4B`, item ativo amarelo `#FFC20E` com texto azul-marinho, fundo `#EEF2F8`, cartões brancos com cantos de 16 px, azul de destaque `#1D5BE0`. Ícones em SVG de traço, sem emoji. Botões de ação sempre acima das tabelas.
- Soluções: `'delivery'` e `'vendas'`. Usuário de papel `admin` tem sempre as duas.

## Tarefa 1 — API: acesso por solução

1. Migração `infra/sql/tenant/035_solucoes_usuario.sql` (espelho em `..\11 - SQL\tenant\` não é necessário nesta branch): coluna `usuarios_admin.solucoes text[] not null default '{delivery}'`, restrição `solucoes <@ array['delivery','vendas']::text[]`, e `update` que dá as duas a quem tem `papel = 'admin'`. Registrar em `schema_migrations`.
2. Login da retaguarda (`admin-auth.controller.ts`): a resposta ganha `solucoes: string[]` e o token ganha a mesma lista (admin = as duas, sempre).
3. `AdminGuard`: token sem `solucoes` vale `['delivery']` (tokens antigos); papel `admin` vale as duas. Rota que começa com `/v1/admin/vendas` exige `'vendas'`. Rotas de autenticação, de usuários e de integração/logs do ERP não exigem solução. Todo o resto de `/v1/admin` exige `'delivery'`. Sem acesso: 403 com `{ statusCode: 403, message: 'Sem acesso a esta solução', codigo: 'SEM_ACESSO_A_SOLUCAO' }`. `req.admin` ganha `solucoes`.
4. Usuários da retaguarda: a listagem devolve `solucoes`; criar e editar aceitam `solucoes` (lista sem repetição, só valores válidos; operador precisa de pelo menos uma). Só `admin` altera.

## Tarefa 2 — API: leituras da retaguarda de Vendas

Tudo em `/v1/admin/vendas`, só leitura, em arquivos novos dentro de `apps/api/src/vendas/` (`admin-vendas-painel.service.ts`, `admin-vendas-consultas.service.ts`, controller próprio ou o existente).

- `GET painel?periodo=hoje|semana|mes&dias=7|30|90&vendedorId=` →
  `{ periodo, indicadores: { pedidos, vendido, ticketMedio, variacaoPedidosPct, variacaoVendidoPct, positivacao: { clientesCarteira, clientesPositivados, pct }, retidos, orcamentosAbertos: { qtd, total } }, evolucao: [{ dia: 'YYYY-MM-DD', vendido, pedidos }], recentes: [{ id, numero, cliente, vendedor, tabela, total, status, criadoEm }], ranking: [{ vendedorId, nome, vendido, pedidos }], categorias: [{ nome, vendido, pct }] }`.
  Variação compara com o período anterior de mesmo tamanho (`null` quando o anterior é zero). Positivação é do mês corrente. `evolucao` devolve todos os dias do intervalo, inclusive os zerados. `recentes` = 8 últimos, incluindo retidos. `ranking` = todos os vendedores ativos, do período. `categorias` = por categoria do produto, do período, 5 maiores + "Outros".
- `GET pedidos?situacao=todos|retidos|liberados|faturados|cancelados&vendedorId=&busca=&pagina=` → `{ dados: [{ id, numero, criadoEm, cliente, clienteCodigo, vendedor, tabela, condicao, total, status, divergencias }], pagina, total }` (30 por página; `liberados` = RECEBIDO, ENVIADO_ERP, ABERTO, EM_FATURAMENTO).
- `GET pedidos/:id` → o pedido de vendedor com cliente, vendedor, tabela, condição, forma do ERP, endereço, itens `[{ produto, codigo, quantidade, precoUnit, total }]`, divergências e eventos. Pedido que não é de vendedor = 404.
- `GET orcamentos?status=aberto|convertido|cancelado&vendedorId=&pagina=` → `{ dados: [{ id, cliente, vendedor, tabela, total, itens, status, pedidoNumero, atualizadoEm }], pagina, total }`.
- `GET clientes?vendedorId=&busca=&pagina=` → só clientes que estão em alguma carteira: `{ dados: [{ id, codigo, razaoSocial, nomeFantasia, documento, cidade, vendedores: [nome], limiteCredito, emAberto, ultimoPedidoEm, status }], pagina, total }`.
- `GET vendedores/:id/carteira` → `[{ id, codigo, razaoSocial, cidade, ultimoPedidoEm }]`.
- `GET produtos?busca=&tabelaId=&pagina=` → `{ tabelas: [{ id, nome }], tabelaId, dados: [{ id, codigo, nome, categoria, estoque, preco, ativo }], pagina, total }` (só tabelas do ERP; sem `tabelaId` usa a primeira por nome).

## Tarefa 3 — Retaguarda: entrada por solução e casca dos painéis

- Sessão guarda `solucoes` e a solução atual. Depois do login: uma solução → entra direto; mais de uma → tela `/solucoes` (cartões Delivery, Vendas, Entregas "em breve" e, para admin, o bloco Administração).
- `Layout` por solução: Delivery = menu e visual de hoje, sem Usuários e Integração ERP; Vendas = visual novo (menu: Início, Vendedores, Pedidos, Orçamentos, Clientes, Tabelas e condições, Produtos; "em breve": Metas, Mapa de vendas, Relatórios); Administração (só admin) = Usuários e Integração ERP. Todos com "Trocar de solução" quando o usuário tem mais de uma.
- Rotas de Vendas sob `/vendas/...`, de Administração sob `/admin/...`; as do Delivery ficam onde estão. Rota de solução que o usuário não tem redireciona para a dele.
- Tela Usuários: marcar as soluções de cada usuário.
- Logo do Vendas: símbolo `public/fluxo-simbolo.png` + "FluxoVendas".

## Tarefa 4 — Retaguarda: Início, Pedidos e Orçamentos de Vendas

Início segue a referência visual do cliente: saudação, filtros (período e vendedor), quatro cartões de indicador com ícone redondo, "Evolução das vendas" em barras com 7/30/90 dias, "Pedidos recentes", "Ranking de vendas", rosca "Vendas por categoria" e a faixa azul-marinho de atenção aos retidos (só quando houver). Pedidos: abas por situação, filtro de vendedor, busca, detalhe com itens e divergências. Orçamentos: lista com filtros.

## Tarefa 5 — Retaguarda: Vendedores, Clientes, Tabelas e condições, Produtos

Vendedores: lista (ERP, carteira, última sincronização, versão do app, situação), definir login/senha e bloquear (API já existe), ver carteira. Clientes: carteira com limite, em aberto e último pedido. Tabelas e condições: marcar as condições aceitas por tabela (API já existe). Produtos: preço por tabela e estoque, só consulta.

## Conferência final

Migração 035 duas vezes na cópia do banco; API e retaguarda rodando contra a cópia; capturas de tela de cada tela de Vendas, da escolha de solução e do Delivery; usuário só-Vendas não alcança rota nem API do Delivery, e o contrário.
