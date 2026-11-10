# Fluxo Vendas — Fase 1 (especificação)

Data: 09/11/2026 · Situação: aguardando revisão do Tiago · Nenhum código escrito

## 1. Objetivo

Dar aos 9 vendedores externos da CAHU Distribuidora um aplicativo próprio para tirar pedidos e orçamentos na rua, inclusive sem internet, usando os mesmos dados, regras comerciais e integração com o ERP (Dlinks) que a plataforma já tem. A fase 1 termina quando 2 vendedores conseguem trabalhar um dia inteiro só com o app novo, em paralelo ao app de terceiros usado hoje.

## 2. Escopo

**Entra na fase 1**

- Login do vendedor e carteira de clientes (cada vendedor vê só os seus).
- Ficha do cliente: cadastro, limite, saldo em aberto, títulos, últimos pedidos, produtos mais comprados.
- Pedido em 8 passos (seção 5), com preço automático pela tabela escolhida.
- Orçamento: salvar, listar, reabrir, converter em pedido.
- Repetir pedido anterior e compartilhar pedido/orçamento em PDF.
- Lista de pedidos do vendedor com situação (rascunho, aguardando envio, retido, enviado, no ERP, em faturamento, faturado, cancelado).
- Funcionamento offline completo para tudo acima.
- Início com vendido hoje, pedidos do dia, ticket médio, positivação e estado da sincronização.
- Retaguarda: seção "Vendas" com Vendedores, Carteira, Pedidos e orçamentos (incluindo retidos) e painel do dia básico; perfil de supervisor.
- Dois endpoints novos para o ERP: vendedores e carteira (cliente × vendedor).

**Fica para depois**

- Fase 2: visitas, motivos de não venda, minha rota, rastreamento por GPS do vendedor, metas e ranking, promoções.
- Fase 3: rotas e rastreamento de entregas (app do motorista).
- Publicação em loja e versão iPhone: o piloto é em Android por APK; o código não deve impedir o iPhone depois.

## 3. Decisões já tomadas

| Tema | Decisão |
|---|---|
| Onde fica | Dentro do repositório `fluxo-commerce`, reaproveitando API, banco e retaguarda |
| Aplicativo | Projeto Flutter separado em `apps/vendas`, com identificação própria; não é um modo dentro do app do cliente |
| Marca | Fluxo Vendas em destaque (azul-marinho, azul vibrante, amarelo), com o nome da distribuidora dentro do app |
| Tabela de preço | Todo vendedor pode escolher qualquer tabela vinda do ERP |
| Preço | Sempre o da tabela escolhida. Vendedor não altera preço nem aplica desconto |
| Promoções do app do cliente | Não valem para o pedido do vendedor (premissa a confirmar) |
| Preço escalonável | Não é usado, fica fora |
| Divergência de preço no envio | Pedido fica retido até o vendedor confirmar ou cancelar |
| Orçamento convertido depois | Recalculado pela tabela atual, com aviso do que mudou |
| Banco | Somente mudanças aditivas a partir da migração 032 |

## 4. Arquitetura

```
ERP (Dlinks) ──envia cadastros──▶ API (módulo integracoes-dlinks, já existe)
ERP (Dlinks) ◀──busca pedidos─── API
                                   │
                    módulo "vendas" (novo)
                     │                │
         App do vendedor         Retaguarda web
        (apps/vendas, novo)   (seção Vendas, nova)
```

### 4.1 Aplicativo (`apps/vendas`)

- Flutter, mesma versão do app do cliente.
- Código comum (cliente HTTP, tema, formatadores, componentes de produto) sai de `apps/mobile/lib/core` e `widgets` para um pacote local compartilhado. A extração não pode mudar o comportamento do app do cliente; os 4 testes existentes continuam passando.
- Banco local SQLite (pacote `drift`).
- Estado no mesmo padrão do app atual (`ChangeNotifier`), sem biblioteca nova.
- Navegação inferior: Início, Clientes, Pedidos, Mais.

### 4.2 API (módulo `vendas`)

Rotas sob `/v1/vendas`, protegidas por um guarda que exige token do tipo `vendedor`.

| Rota | Função |
|---|---|
| `POST /v1/vendas/login` e `/refresh` | Autenticação do vendedor |
| `GET /v1/vendas/sync?desde=` | Devolve o que mudou desde a última sincronização: carteira, clientes, títulos, produtos, estoque, tabelas, preços, formas, condições, vínculo tabela × condição |
| `POST /v1/vendas/pedidos` | Recebe um ou vários pedidos do aparelho (seção 7) |
| `POST /v1/vendas/pedidos/:id/confirmar` e `/cancelar` | Resposta do vendedor a um pedido retido |
| `GET /v1/vendas/pedidos` | Situação dos pedidos do vendedor |
| `POST/GET/PUT /v1/vendas/orcamentos` | Orçamentos |
| `GET /v1/vendas/resumo` | Números da tela Início |

O vendedor só enxerga clientes da própria carteira; toda rota confere isso no servidor.

### 4.3 Banco (migrações 032 em diante)

- `vendedores`: código do ERP, nome, e-mail ou usuário, senha (argon2), ativo, última sincronização, versão do app.
- `cliente_vendedor`: carteira.
- `tabela_preco_condicoes`: quais condições de pagamento cada tabela aceita.
- `orcamentos` e `orcamento_itens`: separados de `pedidos`, porque o ERP importa tudo que está em `pedidos`.
- Em `pedidos`: `vendedor_id`, `origem` (`app_cliente` ou `vendedor`), `tabela_preco_id`, `condicao_pagamento_id`, `id_dispositivo` (único, gerado no aparelho), `motivo_retencao`.
- Novo status `AGUARDANDO_VENDEDOR`, excluído da consulta de pedidos do ERP do mesmo jeito que `AGUARDANDO_PAGAMENTO`.
- `refresh_tokens.sujeito` passa a aceitar `vendedor`.
- Coluna `atualizado_em` nas tabelas sincronizadas que ainda não tiverem.

### 4.4 Retaguarda

Seção "Vendas" no menu existente, ligada por `tenant_features`, visível para os papéis `admin` e `supervisor` (novo). Nenhuma tela atual é alterada além do menu.

## 5. Fluxo do pedido no app

1. Selecionar o cliente (da carteira).
2. Selecionar a tabela de preço (todas as do ERP, com o nome do ERP).
3. Selecionar a condição de pagamento (só as permitidas para a tabela).
4. Selecionar a forma de pagamento (só as permitidas).
5. Definir entrega ou retirada.
6. Escolher pedido final ou orçamento.
7. Adicionar produtos: busca por nome, código ou código de barras; categorias; foto; preço da embalagem e da unidade; estoque; último preço pago pelo cliente.
8. Revisar e salvar.

Regras:

- O preço exibido é o da tabela escolhida. Não existe campo para digitar preço ou desconto.
- Trocar a tabela com itens no carrinho pede confirmação e recalcula todos os itens; nenhum preço da tabela anterior é mantido.
- O pedido registra tabela, condição, forma, tipo de entrega e o preço de cada item.
- A revisão mostra o crédito disponível do cliente e avisa se há título vencido.

## 6. Offline e sincronização

- O aparelho guarda carteira, clientes, títulos, produtos, estoque, todas as tabelas e preços, formas, condições e os pedidos e orçamentos do vendedor.
- Sincroniza ao abrir o app, ao voltar a internet, por botão e periodicamente com o app aberto.
- A tela Início mostra a data e hora da última sincronização. Se os dados não são de hoje, os preços aparecem marcados como desatualizados em todas as telas de produto e no carrinho.
- Pedido feito sem internet fica como "aguardando envio" e sobe sozinho quando houver sinal.
- A sessão não cai por falta de internet. O token de renovação dura 30 dias; vendedor desativado na retaguarda perde o acesso na próxima sincronização.

## 7. Recebimento do pedido no servidor

Para cada pedido recebido:

1. Se o `id_dispositivo` já existe, devolve o pedido existente (reenvio não duplica).
2. Confere se o cliente é da carteira do vendedor e se a condição é permitida para a tabela.
3. Confere cada item contra o preço atual daquela tabela, o estoque e o crédito disponível do cliente.
4. Tudo certo: o pedido entra como `RECEBIDO` e segue o fluxo atual até o ERP.
5. Alguma divergência: o pedido entra como `AGUARDANDO_VENDEDOR`, com o motivo e os valores antigos e novos. O app avisa o vendedor, que confirma (aceitando os valores atuais) ou cancela. O ERP não vê o pedido enquanto ele estiver retido.

A conferência compara com dados vindos do ERP; o módulo não cria regra de preço própria. O aceite final continua sendo do ERP, pelos status que ele já devolve.

Premissa a confirmar: falta de estoque e falta de crédito retêm o pedido do mesmo jeito que a divergência de preço.

## 8. Orçamento

- Guardado no aparelho e no servidor; o supervisor vê na retaguarda.
- Nunca é enviado ao ERP.
- Converter abre o carrinho com os itens, recalcula pela tabela atual, mostra o que mudou e segue o fluxo normal do pedido.
- Pode ser compartilhado em PDF com layout próprio e logo.

## 9. Integração com o ERP

**Já existe e é reaproveitado**: clientes com limite e saldo, produtos com estoque, grupos, fornecedores, tabelas de preço, preços, formas e condições de pagamento, títulos, consulta de pedidos, recebido, cancelado e faturados.

**Novo na fase 1**

- `POST /v1/integracoes/dlinks/funcionarios`: código, nome, filial.
- `POST /v1/integracoes/dlinks/clientes-funcionarios`: código do cliente × código do vendedor.
- Consulta de pedidos passa a devolver o código do vendedor, a tabela e a condição usadas.

**A combinar com o Dlinks**

1. Em que campo o pedido deve levar o código do vendedor e a tabela de preço.
2. Como o vínculo tabela × condição de pagamento será enviado. Enquanto não vier pela integração, ele é cadastrado na retaguarda.
3. Confirmação com dados reais de títulos, condições de pagamento e faturados, que até 22/09 não tinham sido testados.

## 10. Retaguarda na fase 1

- **Vendedores**: lista vinda do ERP, definir e redefinir senha, ativar e desativar, última sincronização, versão do app.
- **Carteira**: clientes por vendedor (leitura; a origem é o ERP).
- **Pedidos e orçamentos**: filtros por vendedor, tabela e situação; aba de pedidos retidos com o motivo.
- **Painel do dia**: vendido hoje, pedidos, ticket médio, positivação, vendedores com hora do primeiro e do último pedido e última sincronização.
- **Tabelas × condições**: cadastro do vínculo enquanto o ERP não enviar.

## 11. Erros que o app precisa tratar

| Situação | Comportamento |
|---|---|
| Sem internet ao salvar | Salva localmente como "aguardando envio" |
| Falha no meio do envio | Reenvia depois; o `id_dispositivo` evita duplicidade |
| Pedido retido | Aviso no app com a diferença; confirmar ou cancelar |
| Cliente saiu da carteira | Some na próxima sincronização; pedidos pendentes dele são retidos |
| Dados de ontem | Preços marcados como desatualizados |
| Vendedor desativado | Acesso encerrado na próxima sincronização; pedidos não enviados ficam visíveis ao supervisor |

## 12. Testes

- API: testes do recebimento de pedido (reenvio, divergência de preço, crédito, estoque, cliente fora da carteira) e dos dois endpoints novos do ERP.
- App: testes do cálculo do carrinho, da troca de tabela e da fila de envio.
- Teste manual em aparelho real com modo avião: tirar 5 pedidos sem sinal, religar e conferir que chegam uma única vez.
- Regressão: o app do cliente e a retaguarda atual continuam funcionando como antes.

## 13. Antes de começar a programar

1. Atualizar a cópia local do repositório, que está 4 atualizações atrás do remoto, e confirmar a versão em produção.
2. Receber o arquivo da logo do Fluxo Vendas.
3. Levar ao Dlinks os três pontos da seção 9.

## 14. Ajustes feitos ao planejar a API (10/11/2026)

- A primeira migração livre é a 034, não a 032.
- A sincronização baixa a carga completa a cada vez, sem parâmetro `desde`. O volume é pequeno e isso dispensa controlar alterações e exclusões.
- O app envia um pedido por chamada e percorre a própria fila.
- Pedido de cliente que saiu da carteira é recusado, não retido, porque o vendedor não teria como resolvê-lo.
- A marca do app é Fluxo Vendas, com o nome da distribuidora dentro do app.

## 15. Riscos

- Migrações são aplicadas manualmente em produção; cada entrega precisa listar as que devem ser rodadas.
- A extração do código comum mexe no app do cliente, que está em produção; por isso é feita primeiro e validada sozinha.
- Servidor único; a sincronização de 9 aparelhos é leve, mas o rastreamento da fase 2 precisa ser dimensionado.
