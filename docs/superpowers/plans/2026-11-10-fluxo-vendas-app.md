# Fluxo Vendas — Aplicativo do vendedor (Plano 2)

**Objetivo:** o vendedor externo tira pedido e orçamento no celular, com ou sem internet, usando os dados do ERP. O aplicativo fala só com a API de Vendas que já existe.

**Base:** branch nova `fluxo-vendas-app`, em cima de `fluxo-vendas-retaguarda`. Projeto Flutter novo em `apps/vendas` (o app do cliente, `apps/mobile`, não é tocado).

## Como o vendedor usa (o que você vai ver)

1. **Entrar:** login e senha definidos na retaguarda. A sessão dura 30 dias, então ele não precisa de internet para abrir o app no dia a dia.
2. **Início:** "Olá, Ana!", vendido hoje e no mês, botões grandes Novo pedido, Clientes, Orçamentos e Catálogo, aviso de pedidos retidos e a linha "Online · última sincronização 09:38" (ou "Sem internet · dados de ontem 18:02").
3. **Clientes (minha carteira):** busca por nome ou código; cada cliente mostra limite, em aberto e última compra. No cliente: dados, financeiro (limite, em aberto, disponível, títulos) e histórico de pedidos.
4. **Novo pedido:**
   - escolhe o **cliente**;
   - escolhe a **tabela de preço** (o nome já diz o prazo e se é entrega ou retirada);
   - escolhe a **forma de pagamento** só quando a tabela aceita mais de uma (retirada: PIX, cartão ou boleto);
   - monta o pedido no **catálogo**, com foto, busca, categorias, estoque e o preço da tabela;
   - **revisa**: itens, total, observação, e decide entre **enviar pedido** ou **salvar como orçamento**.
5. **Depois de enviar:** com internet o pedido vai na hora. Sem internet fica na fila "aguardando envio" e sobe sozinho quando a conexão voltar.
6. **Pedido retido:** se o preço, o estoque ou o crédito mudaram desde a última sincronização, o pedido volta para o vendedor com o motivo e os valores atuais. Ele **confirma com os valores atuais** ou **cancela**. Nada vai para o ERP sem isso.
7. **Pedidos:** fila de envio, retidos, enviados e faturados, com o detalhe de cada um.
8. **Orçamentos:** abrir, alterar, transformar em pedido ou cancelar.

## Regras que o aplicativo obedece

- O vendedor **não altera preço** e **não dá desconto**: o preço é o da tabela vinda do ERP.
- Trocar a tabela com itens no carrinho **recalcula tudo**, com confirmação e mostrando a diferença.
- A tabela define **entrega ou retirada** e as **formas de pagamento** aceitas.
- **Boleto** confere o limite do cliente (limite − em aberto − pedidos a prazo ainda não faturados). Se estourar, o app avisa antes de enviar; quem decide é o servidor.
- Só aparecem clientes da **carteira** do vendedor, e só cliente **cadastrado no ERP**.
- Sem internet o app mostra **a data e a hora dos dados** e marca preço como "pode estar desatualizado" quando a última sincronização tem mais de 12 horas.
- Cada pedido leva um identificador gerado no aparelho: reenviar o mesmo pedido nunca duplica.
- O aplicativo de produção aponta **sempre** para a URL pública do cliente, nunca para IP local.

## Fora desta fase

Metas, rota do dia, mapa, visitas e motivos de não venda, rastreamento por GPS, promoções, e versão para iPhone. O menu já reserva o lugar ("em breve") para Metas e Rota.

## Marca e visual

Segue a referência visual do cliente: cabeçalho azul-marinho `#0B1F4B`, azul `#1D5BE0` nos botões principais, amarelo `#FFC20E` nos destaques, fundo claro, cartões brancos arredondados, barra inferior com Início, Clientes, Pedidos e Mais. Símbolo "S" da família Fluxo com o nome "FluxoVendas"; a logo do cliente aparece no Início e vem do cadastro da distribuidora.

---

## Parte técnica

**Projeto:** `apps/vendas`, Flutter (mesma versão do `apps/mobile`), pacote Android `br.com.fluxocommerce.vendas`, nome "Fluxo Vendas". Configuração por `--dart-define` como no app do cliente (`TENANT`, `API_URL`), com `X-Tenant` em toda chamada.

**Pacotes:** `http`, `drift` + `sqlite3_flutter_libs` + `path_provider` (banco local), `flutter_secure_storage` (tokens), `connectivity_plus`, `uuid`, `intl`, `cached_network_image` (fotos disponíveis sem internet depois de vistas). Estado com `ChangeNotifier`, no mesmo estilo simples do app do cliente; sem biblioteca de estado nova.

**API usada (já pronta e testada):** `POST /v1/vendas/login`, `POST /v1/vendas/refresh`, `GET /v1/vendas/sync`, `GET /v1/vendas/resumo`, `POST /v1/vendas/pedidos`, `GET /v1/vendas/pedidos`, `POST /v1/vendas/pedidos/:id/confirmar`, `POST /v1/vendas/pedidos/:id/cancelar`, `PUT /v1/vendas/orcamentos/:id`, `GET /v1/vendas/orcamentos`, `POST /v1/vendas/orcamentos/:id/cancelar`. Códigos de erro tratados com mensagem própria: `CLIENTE_FORA_DA_CARTEIRA`, `CLIENTE_BLOQUEADO`, `CLIENTE_SEM_CADASTRO_ERP`, `SEM_ENDERECO`, `FORMA_NAO_PERMITIDA`, `TABELA_OU_FORMA_INEXISTENTE`, `TIPO_ENTREGA_DIFERENTE_DA_TABELA`, `PRODUTO_INDISPONIVEL`, `PRODUTO_REPETIDO`, `VALOR_FORA_DO_LIMITE`, `ID_DISPOSITIVO_EM_USO`, `AINDA_DIVERGENTE`.

**Banco local (drift):** espelho da carga (`clientes`, `titulos`, `tabelas` com `tipoEntrega`, `formas`, `tabela_formas`, `categorias`, `produtos`, `precos`, `historico`), mais `pedidos_locais` e `orcamentos_locais` (com itens em JSON, estado e resposta do servidor) e `meta` (última sincronização, vendedor). A carga substitui o espelho inteiro numa transação; pedidos e orçamentos locais nunca são apagados pela carga.

**Sincronização:** ao abrir, ao voltar a conexão, ao puxar a tela e a cada 15 minutos em primeiro plano: primeiro envia a fila (orçamentos e pedidos, na ordem em que foram criados), depois baixa a carga e o resumo. Falha de rede mantém na fila; recusa definitiva do servidor (códigos acima) marca o pedido como "recusado" com o motivo, sem reenviar.

**Cálculo:** total por linha arredondado a 2 casas e somado, igual ao servidor (`conferir-pedido.ts`), com testes usando os mesmos casos.

### Tarefas

1. **Projeto e base:** criar `apps/vendas`, tema e marca, configuração, cliente HTTP com `X-Tenant`, renovação de token e armazenamento seguro, navegação com barra inferior. Ícone e nome do app.
2. **Banco local e carga:** esquema drift, repositórios, gravação transacional da carga, leitura para as telas. Testes do repositório com banco em memória.
3. **Login e sessão:** tela de login, sessão de 30 dias, sair, tratamento de vendedor bloqueado (volta ao login com a mensagem).
4. **Início e sincronização:** resumo, estado online/offline, última sincronização, botão sincronizar, aviso de retidos e de dados antigos.
5. **Clientes:** lista da carteira com busca, detalhe com financeiro, títulos e histórico.
6. **Novo pedido:** cliente → tabela → forma → catálogo (busca, categorias, foto, estoque, preço) → carrinho; troca de tabela com recálculo e confirmação; regra de crédito no aviso. Testes do carrinho e do cálculo.
7. **Revisão, envio e fila:** enviar pedido, salvar orçamento, fila offline com identificador do aparelho, reenvio automático, tela de resultado. Testes da fila (rede caiu, resposta repetida, recusa definitiva).
8. **Pedidos e retidos:** lista por situação, detalhe, confirmar com valores atuais e cancelar.
9. **Orçamentos:** lista, editar, converter em pedido, cancelar.
10. **Fechamento:** `flutter analyze` sem erros, `flutter test` passando, APK de teste apontando para a API de teste (cópia do banco) para conferência de ponta a ponta, e depois o APK apontando para a URL pública.

### Conferência final

Roteiro no aparelho ou emulador contra a cópia do banco: login; carga; pedido online; pedido em modo avião e envio ao voltar a rede; pedido retido por preço, confirmar; pedido retido por crédito, cancelar; orçamento → pedido; troca de tabela com recálculo; tabela de retirada com PIX; vendedor bloqueado na retaguarda perde o acesso. Conferir cada pedido na retaguarda de Vendas e na consulta do ERP.
