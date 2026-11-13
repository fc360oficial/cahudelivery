# Site de vendas da CAHU Distribuidora (apps/site)

Data: 11/11/2026
Status: desenho aprovado pelo Tiago em conversa; aguardando revisão deste documento.

## 1. Objetivo

Um site de vendas com preço aberto para a CAHU Distribuidora, construído sobre a API e a
retaguarda que o app CAHU Delivery já usa. Dois objetivos, em etapas:

1. **Etapa A:** ser a versão de navegador do app, para o cliente comprar e acompanhar pedidos
   pelo computador, com tudo o que o app tem.
2. **Etapa B:** trazer cliente novo pelo Google, com páginas de produto e categoria indexáveis.

A base técnica nasce preparada para a etapa B, para não ser refeita.

Protótipo visual aprovado (Início, Página do produto, Carrinho):
https://claude.ai/artifact/3KHk3M7xWuW8PBBGdeHiiY

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Preço | Aberto: o visitante vê preço sem login |
| Escopo | Paridade com o app (catálogo, compra e toda a área do cliente) |
| Tecnologia | Next.js (App Router) + TypeScript em `apps/site`, no monorepo atual |
| Estilo | CSS próprio com tokens (CSS Modules), sem Tailwind, como a retaguarda |
| Endereço | Provisório em um segundo subdomínio DuckDNS; domínio definitivo depois |
| Indexação | Bloqueada (`noindex`) enquanto o endereço for provisório |
| Preço em destaque | Caixa/fardo em destaque, unidade embaixo (como no protótipo; o app faz o inverso) |
| Regras de negócio | As mesmas do app, porque vêm da mesma API |

## 3. Arquitetura

### 3.1 Visão geral

```
Navegador ──HTTPS──> Caddy (.254) ──> FluxoSite (Next.js, porta própria)
                                          │  chamadas servidor-a-servidor
                                          └──> FluxoAPI (NestJS, localhost:3000, /v1)
```

O site não acessa o banco. Toda leitura e escrita passa pela API `/v1`, com o cabeçalho
`X-Tenant: cahu` vindo de configuração do site (variável de ambiente `TENANT`), o que mantém o
app white label: outro distribuidor é outro deploy com outra configuração.

### 3.2 Renderização

- **Catálogo (início, categoria, busca, produto):** renderizado no servidor, com revalidação
  em cerca de 60 segundos. O preço que o Dlinks atualiza aparece em até um minuto e o Google
  recebe HTML pronto.
- **Carrinho, checkout e área do cliente:** renderizados por requisição, sem cache, porque são
  dados de cada cliente.
- **Preço por cliente:** as páginas em cache mostram a tabela padrão (a do visitante). Com o
  cliente logado, os preços da tela são rebuscados no navegador com a sessão dele e substituem
  os da tabela padrão.

### 3.3 Sessão e carrinho do visitante

- O site expõe rotas próprias (`/api/...`) que repassam as chamadas para a API. É o único
  caminho do navegador até a API.
- **Tokens do cliente** (acesso e renovação) ficam em cookies `HttpOnly`, `Secure`,
  `SameSite=Lax`. O JavaScript da página nunca lê o token.
- **Renovação:** quando a API responde 401, a rota do site usa o token de renovação
  (`POST /v1/auth/refresh`), grava os cookies novos e repete a chamada uma vez. Se falhar,
  limpa a sessão e o cliente vai para o login com retorno à tela de origem.
- **Carrinho anônimo:** um UUID gerado pelo site fica em cookie e é enviado como
  `X-Device-Id`, o mesmo mecanismo do app. Depois do login a API já mescla o carrinho do
  dispositivo no do cliente.
- **CSRF:** as rotas `/api` que alteram dados exigem origem igual à do site (verificação de
  `Origin`) além do `SameSite`.

### 3.4 Estrutura de `apps/site`

```
apps/site/
  src/app/                  rotas (uma pasta por página)
    (loja)/                 início, c/[categoria], busca, p/[slug]
    carrinho/  checkout/    compra
    conta/                  área do cliente (pedidos, notas, enderecos, ...)
    api/                    rotas que repassam para a API /v1
  src/lib/
    api/                    cliente da API (servidor), tipos de @fluxo/shared-types
    sessao/                 cookies, renovação de token, device id
    formato/                preço, unidade, caixa, datas
  src/componentes/          cartão de produto, cabeçalho, rodapé, stepper, selos, estados
  src/estilos/              tokens.css (cores, tipografia, espaçamento do protótipo)
```

Cada unidade tem uma responsabilidade: `lib/api` só fala com a API, `lib/sessao` só cuida de
cookies e token, `lib/formato` é função pura e testável, componentes não buscam dados.

### 3.5 Mudanças na API

Duas, pequenas e compatíveis com o app atual:

1. **Origem do pedido.** `pedidos.origem` hoje aceita `app_cliente` e `vendedor`
   (migração 034). Nova migração (040, `040_origem_site.sql`) acrescenta `site` ao `check`. `POST /v1/pedidos` passa
   a aceitar o cabeçalho opcional `X-Canal: site`; sem ele o valor continua `app_cliente`.
   A retaguarda mostra a origem na lista e no detalhe do pedido.
2. **Retorno do cartão (3DS).** A página `GET /v1/pagamentos/3ds/:tenant/:resultado` hoje diz
   "volte ao aplicativo". Passa a aceitar um parâmetro opcional de retorno, validado contra a
   URL do site configurada no tenant: quando presente, redireciona para a página do pedido no
   site; quando ausente, o comportamento atual do app é mantido.

Nenhuma outra rota muda. As rotas usadas pelo site: `config`, `home`, `categorias`,
`produtos`, `produtos/:id`, `produtos/:id/relacionados`, `promocoes`, `auth/*`, `carrinho*`,
`pedidos*`, `perfil*`, `favoritos*`, `credito*`, `carteira`, `indicacoes`, `notificacoes`,
e os arquivos de nota (`notas/:tenant/:pedidoId/nota.xml` e `danfe.pdf`).

## 4. Blocos de entrega

Cada bloco é publicável e testável sozinho.

### Bloco 1: Catálogo

- **Início:** banners da retaguarda, Ofertas da Semana, vitrines por categoria, vitrines
  patrocinadas, Vencimento Próximo e Mais Pedidos, na ordem que `GET /v1/home` devolve.
- **Categoria e busca:** grade de produtos, filtro por subcategoria e marca, ordenação por
  nome ou preço, paginação por parâmetro de URL.
- **Página do produto:** fotos, preço da caixa e da unidade lado a lado, quantidade mínima,
  faixa de desconto por quantidade, selos de estoque baixo e de validade, relacionados.
- **Cartão de produto:** foto, categoria, nome, embalagem, preço da caixa em destaque, preço
  da unidade embaixo, botão de adicionar, coração de favorito (ativo a partir do Bloco 3).
- **Cabeçalho e rodapé:** busca, categorias, entrar, carrinho com contador; dados da empresa
  vindos de `GET /v1/config`.
- **Endereços:** `/p/<slug>-<id>` e `/c/<slug>-<id>`. O slug é gerado do nome; o id é o que
  identifica. Slug divergente redireciona para o correto.
- No Bloco 1 o botão de adicionar já grava no carrinho anônimo; a tela de carrinho vem no 2.

### Bloco 2: Compra

- **Carrinho:** itens, quantidade, barra do pedido mínimo, total. Sem login.
- **Entrar ou cadastrar:** só ao fechar o pedido. Fluxos existentes: login por CNPJ/CPF e
  senha, primeiro acesso com código da retaguarda, cadastro com CNPJ, inscrição estadual e
  município. Carrinho do visitante mesclado após o login.
- **Checkout em três passos:** (1) entrega ou retirada, com endereço e busca por CEP;
  (2) pagamento conforme a configuração da retaguarda: PIX, cartão, boleto com as condições
  do cliente, uso do saldo da carteira; (3) revisão e confirmação.
- **PIX:** QR code e copia-e-cola; a tela consulta o pedido periodicamente e muda sozinha
  quando o pagamento é confirmado.
- **Cartão:** mesmos endpoints do app (`pagar-cartao` e `confirmar`); o desafio do banco abre
  na própria aba e volta para a página do pedido (mudança 2 da seção 3.5).
- **Bloqueios:** o que a API recusa (cliente bloqueado, título vencido, abaixo do mínimo, sem
  estoque) aparece com o motivo e o botão "Falar com a distribuidora".

### Bloco 3: Área do cliente

- **Meus pedidos:** lista, detalhe com linha do tempo, repetir pedido, XML e DANFE.
- **Notas fiscais, endereços, favoritos, carteira (saldo e extrato), crédito, notificações,
  indicação, dados do perfil, troca de senha, exclusão de conta.**

### Bloco 4: Google (ativado quando houver domínio definitivo)

- `sitemap.xml` gerado do catálogo, `robots.txt`, URL canônica em cada página.
- Dados estruturados (`Product` com preço e disponibilidade, `BreadcrumbList`).
- Título e descrição por página; imagem de compartilhamento.
- Retirada do `noindex` por variável de ambiente (`SITE_INDEXAVEL=true`).

### Fora do escopo

- Notificação push no navegador (o site lista as notificações, não envia alerta).
- Qualquer função do Fluxo Vendas (vendedor).
- Mudança de regra de negócio: preço, crédito, mínimo e bloqueios continuam os da API.

## 5. Tratamento de erros

| Situação | Comportamento |
|---|---|
| API fora do ar, catálogo | Serve a última versão em cache com aviso discreto |
| API fora do ar, carrinho/checkout/conta | Mensagem "tente novamente", sem tela em branco |
| Preço ou estoque mudou | Carrinho recalculado pela API; novo total mostrado antes de confirmar |
| Sessão expirada | Renovação automática; se falhar, login com retorno à tela de origem |
| Produto ou página inexistente | 404 própria com busca e categorias |
| Erro de regra da API (4xx) | Mensagem da API exibida ao cliente, com caminho de saída |

## 6. Segurança

- Tokens só em cookie `HttpOnly`; nada de token em `localStorage`.
- Verificação de `Origin` nas rotas `/api` que alteram dados.
- Dados de cartão seguem o caminho do app até a operadora; o site não armazena cartão.
- Limite de tentativas de login: o da API.
- Cabeçalhos de segurança no Next (CSP, `X-Frame-Options`, `Referrer-Policy`).
- Revisão de segurança dedicada antes de publicar o Bloco 2.

## 7. Testes

- **Unitários (Vitest):** `lib/formato` (preço, caixa/unidade, slug), regras de exibição dos
  selos, renovação de token em `lib/sessao`.
- **Ponta a ponta (Playwright):** buscar, abrir produto, adicionar, entrar, fechar com PIX,
  ver o pedido em "Meus pedidos". Roda contra a API e o banco de desenvolvimento antes de
  cada publicação.
- **API:** testes das duas mudanças da seção 3.5, incluindo que o app sem o cabeçalho novo
  continua gravando `app_cliente` e que o retorno 3DS sem parâmetro não muda.
- **Produção:** pedido real de valor baixo em cada forma de pagamento antes de divulgar o
  Bloco 2.

## 8. Desempenho

- Fotos com `<img loading="lazy">` usando a miniatura que a API já gera (`url_miniatura`) nos
  cartões e a foto cheia só na página do produto. O componente de imagem do Next foi descartado
  (12/11/2026): ele baixaria a foto pelo endereço público a partir do próprio servidor, o que
  depende do roteador da CAHU permitir essa volta, e bloqueia hosts locais por padrão.
- Meta: página de produto com LCP abaixo de 2 s em 4G (Lighthouse móvel), medida ao fim do
  Bloco 1.

## 9. Publicação

- Código pelo GitHub; no .254: `git pull`, `npm run build` em `apps/site`, reinício do
  serviço NSSM `FluxoSite` (`next start` em porta própria, a confirmar livre no dia).
- Variáveis de ambiente do serviço: `API_URL=http://localhost:3000/v1`, `TENANT=cahu`,
  `SITE_URL=<endereço público>`, `SITE_INDEXAVEL=false`.
- Subdomínio DuckDNS novo para o site, na mesma conta do `cahudelivery`.
- Bloco novo no Caddyfile compartilhado (`C:\fc360\claude_code_\Caddyfile`) para esse
  endereço, com proxy para a porta do `FluxoSite`. **Edição feita só com OK explícito do
  Tiago no dia**, com backup do arquivo e `caddy validate` antes do `caddy reload`.
- A retaguarda e a API continuam em `cahudelivery.duckdns.org`, sem alteração de acesso.
- Troca para o domínio definitivo: novo bloco no Caddy, `SITE_URL` atualizado e, quando o
  Bloco 4 estiver pronto, `SITE_INDEXAVEL=true`.

## 10. Ordem de implementação

Cada bloco terá o seu próprio plano de implementação. O primeiro plano cobre a fundação
(`apps/site`, tokens, cliente da API, sessão) e o Bloco 1. As duas mudanças da API entram no
plano do Bloco 2, que é onde são usadas.
