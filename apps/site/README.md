# Site de vendas (apps/site)

Catálogo público de preço aberto, em Next.js, sobre a API `/v1` do Fluxo Commerce.
Spec: `docs/superpowers/specs/2026-11-11-site-cahu-design.md`.

## Rodar

A API precisa estar no ar (o site não acessa o banco):

    npm run api      # raiz do repo, porta 3000
    npm run site     # raiz do repo, porta 3010

## Variáveis de ambiente

| Variável | Padrão | Para que serve |
|---|---|---|
| `API_URL` | `http://localhost:3000/v1` | Endereço da API, visto pelo servidor do site |
| `TENANT` | `cahu` | Slug do tenant enviado em `X-Tenant` |
| `SITE_URL` | `http://localhost:3010` | Endereço público do site |
| `EMPRESA_ENDERECO` | (vazio) | Endereço da empresa, mostrado na última linha do rodapé ao lado da razão social e do CNPJ |
| `VENDE_BEBIDA_ALCOOLICA` | (vazio) | `true` mostra no rodapé a advertência de bebida alcoólica |
| `SITE_INDEXAVEL` | (vazio) | Só `true` libera o Google; qualquer outro valor mantém `noindex` (trocar exige rebuild, ver "Antes de abrir ao público") |

## Testes

    npm test --workspace apps/site       # unitários (Vitest)
    npm run e2e --workspace apps/site    # ponta a ponta (Playwright); exige a API no ar

## Como funciona

- Páginas de catálogo são montadas no servidor com cache de 60 s sobre a API.
- O navegador só fala com `/api/*` do próprio site; essas rotas repassam para a API.
- O carrinho do visitante usa o cookie `fc_dispositivo` (HttpOnly), enviado à API como `X-Device-Id`.
- O build (`npm run build`) precisa da API no ar, porque a página inicial é gerada nele.

## Antes de abrir ao público

- **Limite de requisições no Caddy.** A busca (`/busca?q=`) não usa cache e cada consulta chega ao banco; ponha rate limiting no Caddy.
- **`Strict-Transport-Security` no Caddy**, depois de confirmar que o https funciona em todos os caminhos.
- **`PUBLIC_URL` da API** precisa ser o host público em https. As URLs de imagem já gravadas com IP local (fotos de produtos, banners, logo) precisam ser corrigidas; senão quebram fora da rede e viram conteúdo misto em https.
- **`SITE_INDEXAVEL`:** o `robots.txt` lê a variável a cada requisição, mas o `noindex` das páginas é gravado no build e só se renova com a revalidação. Depois de trocar o valor, faça rebuild e reinicie o site.
- O cookie do carrinho só é `Secure` quando a requisição chega em https (cabeçalho `x-forwarded-proto: https` do Caddy); em http puro (ex.: teste na rede local) ele é gravado sem `Secure`.

## Desempenho

Medição do Lighthouse móvel na página do produto, ao fim do Bloco 1: LCP de 3096 ms, nota 93 (meta: abaixo de 2000 ms; medido em 12/11/2026 com o banco de desenvolvimento, foto principal PNG de 213 KB servida pela API; acima da meta, a conferir com fotos reais).
