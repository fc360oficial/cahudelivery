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
| `SITE_INDEXAVEL` | (vazio) | Só `true` libera o Google; qualquer outro valor mantém `noindex` |

## Testes

    npm test --workspace apps/site       # unitários (Vitest)
    npm run e2e --workspace apps/site    # ponta a ponta (Playwright); exige a API no ar

## Como funciona

- Páginas de catálogo são montadas no servidor com cache de 60 s sobre a API.
- O navegador só fala com `/api/*` do próprio site; essas rotas repassam para a API.
- O carrinho do visitante usa o cookie `fc_dispositivo` (HttpOnly), enviado à API como `X-Device-Id`.
- O build (`npm run build`) precisa da API no ar, porque a página inicial é gerada nele.

## Desempenho

Medição do Lighthouse móvel na página do produto, ao fim do Bloco 1: LCP de 3096 ms, nota 93 (meta: abaixo de 2000 ms; medido em 12/11/2026 com o banco de desenvolvimento, foto principal PNG de 213 KB servida pela API; acima da meta, a conferir com fotos reais).
