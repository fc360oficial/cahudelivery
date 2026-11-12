# Site CAHU, Bloco 1 (fundação + catálogo): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `apps/site` (Next.js) com o catálogo público de preço aberto da CAHU: início, categoria, busca, ofertas, página do produto e carrinho do visitante, consumindo a API `/v1` existente.

**Architecture:** App Next.js (App Router) no monorepo. Páginas de catálogo renderizadas no servidor com cache de 60 s sobre a API NestJS; o navegador só fala com rotas `/api` do próprio site, que repassam para a API com `X-Tenant` e `X-Device-Id` (cookie `HttpOnly`). Funções puras em `src/lib` com testes; componentes não buscam dados.

**Tech Stack:** Next.js (versão estável atual) + React 19 + TypeScript, CSS Modules com tokens, Vitest, Playwright. API: NestJS + Jest (já existentes).

**Spec:** `docs/superpowers/specs/2026-11-11-site-cahu-design.md`

## Global Constraints

- Tudo em português: nomes de arquivo, funções, variáveis, textos e mensagens de commit, como no resto do repo.
- Sem Tailwind e sem biblioteca de componentes. CSS Modules + `src/estilos/tokens.css`.
- Cores do protótipo: tinta `#141414`, tinta suave `#5f5f5a`, linha `#ececea`, fundo suave `#f5f5f3`, destaque `#FFD500` (sobrescrito pela `cor_primaria` do tenant).
- O site nunca acessa o banco; só a API `/v1`, sempre com `X-Tenant` vindo da variável `TENANT`.
- Nenhum token, device id ou URL interna da API chega ao JavaScript do navegador.
- Mudanças na API são só aditivas: o app Flutter atual tem que continuar funcionando sem alteração.
- Preço em destaque = preço da embalagem de venda (`preco`); preço por unidade embaixo quando `qtd_por_embalagem > 1`.
- Valores `numeric` do Postgres chegam da API como **string**: sempre passar pelo normalizador antes de usar.
- Site sai com `noindex` enquanto `SITE_INDEXAVEL` não for `true`.
- Commits pequenos, um por tarefa, direto na `main` (padrão do repo), **sem push**. Terminar cada mensagem com `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Porta do site: `3010`. API local: `http://localhost:3000/v1`.
- O repo fica dentro do OneDrive. Se `next build` falhar com `EPERM` em `.next`, pausar a sincronização do OneDrive e repetir.

## Fora deste plano

- Login, cadastro, checkout, pagamento (Bloco 2) e área do cliente (Bloco 3).
- Preço da tabela própria do cliente logado (depende do login, Bloco 2).
- Sitemap e dados estruturados (Bloco 4).
- Publicação no .254: roteiro separado, escrito e executado com o OK do Tiago depois que o Bloco 1 estiver aprovado localmente.

## Desvio da spec

A spec (seção 8) previa o componente de imagem do Next. Este plano usa `<img loading="lazy">` com a miniatura que a API já gera (`url_miniatura`). Motivo: o otimizador do Next teria que baixar a foto pelo endereço público a partir do próprio servidor (o roteador da CAHU pode não permitir essa volta) e bloqueia hosts locais por padrão. A spec foi ajustada no mesmo commit deste plano.

## Mapa de arquivos

```
apps/api/src/catalog/
  catalog.service.ts            (modificar: ordenação, temMais, marca_id, marcas())
  catalog.controller.ts         (modificar: ?ordem=, GET /marcas)
  catalog-listagem.spec.ts      (criar)

apps/site/
  package.json  tsconfig.json  next.config.ts  vitest.config.ts  playwright.config.ts  README.md
  e2e/catalogo.spec.ts
  src/estilos/tokens.css
  src/lib/formato/      preco.ts  embalagem.ts  caminhos.ts  datas.ts  formato.test.ts
  src/lib/api/          tipos.ts  normalizar.ts  normalizar.test.ts  cliente.ts  cliente.test.ts  catalogo.ts
  src/lib/sessao/       dispositivo.ts  origem.ts  item.ts  sessao.test.ts
  src/lib/catalogo/     selos.ts  home.ts  filtros.ts  preco-efetivo.ts  catalogo.test.ts
  src/lib/site.ts       site.test.ts
  src/componentes/      Cabecalho  Rodape  CarrinhoProvider  BotaoAdicionar  ContadorCarrinho
                        CartaoProduto  Vitrine  Banners  ListaProdutos  Galeria  CompraProduto
                        AvisoDesatualizado   (cada um .tsx + .module.css quando tem estilo)
  src/app/              layout.tsx  page.tsx  robots.ts  error.tsx  not-found.tsx
                        c/[slug]/page.tsx  busca/page.tsx  ofertas/page.tsx  p/[slug]/page.tsx
                        carrinho/page.tsx  api/carrinho/route.ts  api/carrinho/itens/route.ts
```

---

### Task 1: API do catálogo: ordenação, "tem mais", marca_id e lista de marcas

**Files:**
- Modify: `apps/api/src/catalog/catalog.service.ts`
- Modify: `apps/api/src/catalog/catalog.controller.ts`
- Test: `apps/api/src/catalog/catalog-listagem.spec.ts`

**Interfaces:**
- Produces: `GET /v1/produtos` aceita `?ordem=nome|preco_asc|preco_desc` e devolve `{ dados, pagina, temMais }`; cada produto ganha `marca_id`; `GET /v1/marcas?categoria=<uuid opcional>` devolve `[{ id, nome, produtos }]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/catalog/catalog-listagem.spec.ts`:

```ts
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from './catalog.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar(linhasProdutos: unknown[] = []) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from produtos p') && sql.includes('limit $')) return { rows: linhasProdutos };
    return { rows: [] };
  });
  const svc = new CatalogService({} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { svc, query, rodar };
}
const chamadas = (q: jest.Mock) => q.mock.calls.map((c) => ({ sql: String((c as unknown[])[0]), params: (c as unknown[])[1] as unknown[] }));
const listagem = (q: jest.Mock) => chamadas(q).find((c) => c.sql.includes('limit $'))!;

describe('CatalogService.produtos: listagem do site', () => {
  it('pede um item a mais e devolve temMais=true sem o item extra', async () => {
    const { svc, query, rodar } = montar([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const r = await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(listagem(query).params.slice(-2)).toEqual([3, 0]);
    expect(r.dados).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(r.temMais).toBe(true);
  });

  it('temMais=false quando não sobra item', async () => {
    const { svc, rodar } = montar([{ id: 'a' }]);
    const r = await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(r.dados).toHaveLength(1);
    expect(r.temMais).toBe(false);
  });

  it('ordem preco_asc ordena pelo preço final', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.produtos({ pagina: 1, limite: 2, ordem: 'preco_asc' }));
    expect(listagem(query).sql).toContain('order by coalesce(promo.preco_promocional, pr.preco) asc nulls last, p.nome');
  });

  it('ordem desconhecida cai em nome', async () => {
    for (const ordem of ['qualquer; drop table', 'constructor', 'toString']) {
      const { svc, query, rodar } = montar();
      await rodar(() => svc.produtos({ pagina: 1, limite: 2, ordem }));
      expect(listagem(query).sql).toContain('order by p.nome limit');
    }
  });

  it('produto traz marca_id', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.produtos({ pagina: 1, limite: 2 }));
    expect(listagem(query).sql).toContain('p.marca_id');
  });
});

describe('CatalogService.marcas', () => {
  it('lista marcas com produto em estoque, filtrando pela categoria', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.marcas('cat-1'));
    const c = chamadas(query).find((x) => x.sql.includes('from marcas m'))!;
    expect(c.sql).toContain('e.quantidade > 0');
    expect(c.params).toEqual(['cat-1']);
  });

  it('sem categoria manda null', async () => {
    const { svc, query, rodar } = montar();
    await rodar(() => svc.marcas());
    expect(chamadas(query).find((x) => x.sql.includes('from marcas m'))!.params).toEqual([null]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/api -- catalog-listagem`
Expected: FAIL (`temMais` indefinido, `svc.marcas is not a function`).

- [ ] **Step 3: Implementar no serviço**

Em `apps/api/src/catalog/catalog.service.ts`:

1. Na interface `FiltroProdutos`, acrescentar o campo:

```ts
  ordem?: string;
```

2. Em `SELECT_PRODUTO_BASE`, trocar `m.nome as marca,` por:

```ts
m.nome as marca, p.marca_id,
```

3. Logo abaixo da constante `SELECT_PRODUTO`, acrescentar:

```ts
/** Ordenações aceitas na listagem. A chave vem da query string; o SQL sai sempre desta tabela fixa. */
const PRECO_FINAL = 'coalesce(promo.preco_promocional, pr.preco)';
const ORDENACOES: Record<string, string> = {
  nome: 'p.nome',
  preco_asc: `${PRECO_FINAL} asc nulls last, p.nome`,
  preco_desc: `${PRECO_FINAL} desc nulls last, p.nome`,
};
```

4. No método `produtos`, substituir do `params.push(f.limite, ...)` até o `return` por:

```ts
    // hasOwn: chave como "constructor" ou "toString" não pode cair numa propriedade herdada do objeto.
    const ordem = f.ordem && Object.hasOwn(ORDENACOES, f.ordem) ? ORDENACOES[f.ordem] : ORDENACOES.nome;
    // Um item a mais que o limite: diz se existe próxima página sem um count(*) separado.
    params.push(f.limite + 1, (f.pagina - 1) * f.limite);
    const { rows } = await pool.query(
      // Lista de promoções ("Ver todos" das Ofertas) agrupada por categoria, como a vitrine da Home.
      `${SELECT_PRODUTO}${where} order by ${f.promocao ? 'c.ordem, c.nome, ' : ''}${ordem} limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    const temMais = rows.length > f.limite;
    return { dados: temMais ? rows.slice(0, f.limite) : rows, pagina: f.pagina, temMais };
```

5. Acrescentar o método depois de `categorias()`:

```ts
  /** Marcas com produto ativo e em estoque; com categoria, só as daquela categoria (ou das filhas). */
  async marcas(categoriaId?: string) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select m.id, m.nome, count(*)::int as produtos
         from marcas m
         join produtos p on p.marca_id = m.id and p.ativo
         join estoques e on e.produto_id = p.id and e.quantidade > 0
         left join categorias c on c.id = p.categoria_id
        where m.ativo and ($1::uuid is null or p.categoria_id = $1::uuid or c.pai_id = $1::uuid)
        group by m.id, m.nome
        order by m.nome`,
      [categoriaId ?? null],
    );
    return rows;
  }
```

- [ ] **Step 4: Implementar no controller**

Em `apps/api/src/catalog/catalog.controller.ts`:

1. No método `produtos`, acrescentar o parâmetro depois de `promocao`:

```ts
    @Query('ordem') ordem?: string,
```

e, no objeto passado a `this.catalog.produtos`, acrescentar `ordem,` depois de `busca,`.

2. Acrescentar a rota depois de `categorias()`:

```ts
  @Get('marcas')
  marcas(@Query('categoria', new ParseUUIDPipe({ optional: true })) categoria?: string) {
    return this.catalog.marcas(categoria);
  }
```

- [ ] **Step 5: Rodar os testes da API**

Run: `npm test --workspace apps/api`
Expected: PASS em toda a suíte (inclusive `catalog-origem.spec.ts`, que não muda).

- [ ] **Step 6: Conferir de verdade**

Com a API rodando (`npm run api`):

```bash
curl -s -H "X-Tenant: cahu" "http://localhost:3000/v1/produtos?limite=2&ordem=preco_asc" | head -c 400
curl -s -H "X-Tenant: cahu" "http://localhost:3000/v1/marcas" | head -c 300
```

Expected: o primeiro JSON termina com `"pagina":1,"temMais":true` e cada produto tem `marca_id`; o segundo é uma lista `[{"id":...,"nome":...,"produtos":N}]`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/catalog
git commit -m "API catálogo: ordenação por preço, temMais, marca_id e GET /marcas (para o site)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 2: Esqueleto de `apps/site` e funções de formato

**Files:**
- Modify: `package.json` (raiz), `.gitignore`
- Create: `apps/site/package.json`, `apps/site/tsconfig.json`, `apps/site/next.config.ts`, `apps/site/vitest.config.ts`
- Create: `apps/site/src/estilos/tokens.css`, `apps/site/src/app/layout.tsx`, `apps/site/src/app/page.tsx`
- Create: `apps/site/src/lib/formato/preco.ts`, `embalagem.ts`, `caminhos.ts`, `datas.ts`
- Test: `apps/site/src/lib/formato/formato.test.ts`

**Interfaces:**
- Produces:
  - `formatarPreco(valor: number): string` (ex.: `"R$ 52,80"`, espaço comum)
  - `precoPorUnidade(preco: number, qtdPorEmbalagem: number): number | null`
  - `percentualDesconto(precoTabela: number | null, preco: number | null): number | null`
  - `nomeEmbalagem(unidade: string): string`, `rotuloEmbalagem(unidade: string, qtd: number): string`
  - `slugificar(texto: string): string`, `idDoSegmento(segmento: string): string | null`
  - `caminhoProduto({ id, nome }): string` → `/p/<slug>-<id>`; `caminhoCategoria({ id, nome }): string` → `/c/<slug>-<id>`
  - `formatarValidade(iso: string): string` → `"DD/MM"`

- [ ] **Step 1: Registrar o workspace**

Em `package.json` da raiz, no array `workspaces`, acrescentar `"apps/site"` depois de `"apps/admin"`, e em `scripts` acrescentar:

```json
    "site": "npm run dev --workspace apps/site",
```

Em `.gitignore`, acrescentar ao final:

```
# Site (Next.js)
.next/
apps/site/next-env.d.ts
apps/site/test-results/
apps/site/playwright-report/
```

- [ ] **Step 2: Criar `apps/site/package.json`**

```json
{
  "name": "site",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "next dev --port 3010",
    "build": "next build",
    "start": "next start --port 3010",
    "test": "vitest run",
    "e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Instalar dependências**

Na raiz do repo:

```bash
npm install next react react-dom --workspace apps/site
npm install -D typescript @types/node @types/react @types/react-dom vitest --workspace apps/site
```

Expected: termina sem erro; `apps/site/package.json` ganha `dependencies` e `devDependencies`.

- [ ] **Step 4: Criar a configuração**

`apps/site/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "e2e"]
}
```

`apps/site/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
};

export default config;
```

`apps/site/vitest.config.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

- [ ] **Step 5: Escrever o teste que falha**

`apps/site/src/lib/formato/formato.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { caminhoCategoria, caminhoProduto, idDoSegmento, slugificar } from './caminhos';
import { formatarValidade } from './datas';
import { nomeEmbalagem, rotuloEmbalagem } from './embalagem';
import { formatarPreco, percentualDesconto, precoPorUnidade } from './preco';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';

describe('preço', () => {
  it('formata em reais com espaço comum', () => {
    expect(formatarPreco(52.8)).toBe('R$ 52,80');
    expect(formatarPreco(1234.5)).toBe('R$ 1.234,50');
  });
  it('preço por unidade só quando a embalagem tem mais de uma', () => {
    expect(precoPorUnidade(52.8, 24)).toBe(2.2);
    expect(precoPorUnidade(10, 1)).toBeNull();
    expect(precoPorUnidade(10, 0)).toBeNull();
  });
  it('percentual de desconto arredondado, nulo sem desconto', () => {
    expect(percentualDesconto(79.9, 59.9)).toBe(25);
    expect(percentualDesconto(10, 10)).toBeNull();
    expect(percentualDesconto(null, 10)).toBeNull();
    expect(percentualDesconto(10, null)).toBeNull();
  });
});

describe('embalagem', () => {
  it('nomeia a unidade de venda', () => {
    expect(nomeEmbalagem('CX')).toBe('Caixa');
    expect(nomeEmbalagem('fd')).toBe('Fardo');
    expect(nomeEmbalagem('XX')).toBe('Embalagem');
  });
  it('rótulo com a quantidade quando maior que 1', () => {
    expect(rotuloEmbalagem('CX', 24)).toBe('Caixa com 24 unidades');
    expect(rotuloEmbalagem('UN', 1)).toBe('Unidade');
  });
});

describe('caminhos', () => {
  it('slug sem acento, minúsculo, com hífen', () => {
    expect(slugificar('Açúcar Cristal 1 kg')).toBe('acucar-cristal-1-kg');
    expect(slugificar('  Óleo/Soja  ')).toBe('oleo-soja');
    expect(slugificar('***')).toBe('item');
  });
  it('monta e lê o caminho do produto e da categoria', () => {
    expect(caminhoProduto({ id: ID, nome: 'Detergente Neutro 500 ml' })).toBe(`/p/detergente-neutro-500-ml-${ID}`);
    expect(caminhoCategoria({ id: ID, nome: 'Higiene e Beleza' })).toBe(`/c/higiene-e-beleza-${ID}`);
    expect(idDoSegmento(`detergente-neutro-500-ml-${ID}`)).toBe(ID);
    expect(idDoSegmento(ID.toUpperCase())).toBe(ID);
    expect(idDoSegmento('sem-id')).toBeNull();
  });
});

describe('datas', () => {
  it('validade em DD/MM', () => {
    expect(formatarValidade('2026-12-05')).toBe('05/12');
    expect(formatarValidade('2026-12-05T03:00:00.000Z')).toBe('05/12');
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (módulos `./preco`, `./embalagem`, `./caminhos`, `./datas` não existem).

- [ ] **Step 7: Implementar as funções**

`apps/site/src/lib/formato/preco.ts`:

```ts
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 52,80". O Intl usa espaço inseparável; trocamos por espaço comum para comparar e copiar. */
export function formatarPreco(valor: number): string {
  return BRL.format(valor).replace(/ /g, ' ');
}

/** Preço de cada unidade dentro da embalagem; nulo quando a embalagem é a própria unidade. */
export function precoPorUnidade(preco: number, qtdPorEmbalagem: number): number | null {
  if (!(qtdPorEmbalagem > 1)) return null;
  return Math.round((preco / qtdPorEmbalagem) * 100) / 100;
}

/** Desconto inteiro em % entre o preço de tabela e o preço final; nulo se não há desconto. */
export function percentualDesconto(precoTabela: number | null, preco: number | null): number | null {
  if (precoTabela == null || preco == null || !(precoTabela > 0) || preco >= precoTabela) return null;
  return Math.round((1 - preco / precoTabela) * 100);
}
```

`apps/site/src/lib/formato/embalagem.ts`:

```ts
const NOMES: Record<string, string> = { UN: 'Unidade', CX: 'Caixa', FD: 'Fardo', PC: 'Pacote', KG: 'Quilo' };

export function nomeEmbalagem(unidade: string): string {
  return NOMES[String(unidade ?? '').toUpperCase()] ?? 'Embalagem';
}

export function rotuloEmbalagem(unidade: string, qtd: number): string {
  const nome = nomeEmbalagem(unidade);
  return qtd > 1 ? `${nome} com ${qtd} unidades` : nome;
}
```

`apps/site/src/lib/formato/caminhos.ts`:

```ts
const UUID_NO_FIM = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UUID_INTEIRO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugificar(texto: string): string {
  const slug = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** O id é o que identifica; o slug é só enfeite do endereço. */
export function idDoSegmento(segmento: string): string | null {
  const m = UUID_NO_FIM.exec(segmento);
  return m ? m[0].toLowerCase() : null;
}

export function caminhoProduto(p: { id: string; nome: string }): string {
  return `/p/${slugificar(p.nome)}-${p.id}`;
}

export function caminhoCategoria(c: { id: string; nome: string }): string {
  return `/c/${slugificar(c.nome)}-${c.id}`;
}
```

`apps/site/src/lib/formato/datas.ts`:

```ts
/** Recebe "AAAA-MM-DD" ou ISO completo e devolve "DD/MM". */
export function formatarValidade(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS (todos os testes de `formato.test.ts`).

- [ ] **Step 9: Tokens e página mínima**

`apps/site/src/estilos/tokens.css`:

```css
:root {
  --tinta: #141414;
  --tinta-suave: #5f5f5a;
  --linha: #ececea;
  --linha-forte: #c9c9c4;
  --fundo: #ffffff;
  --fundo-suave: #f5f5f3;
  --destaque: #ffd500;
  --sobre-destaque: #141414;
  --positivo: #14693a;
  --alerta: #9a4a00;
  --perigo: #b42318;
  --raio-p: 12px;
  --raio-m: 20px;
  --raio-g: 28px;
  --raio-pilula: 999px;
  --largura: 1232px;
  --margem: 32px;
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  font-family: var(--fonte-texto), system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--tinta);
  background: var(--fundo);
}
a { color: inherit; }
h1, h2, h3 {
  margin: 0;
  font-family: var(--fonte-titulo), var(--fonte-texto), sans-serif;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}
img { display: block; max-width: 100%; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--tinta); outline-offset: 2px; }

.conteudo { max-width: var(--largura); margin: 0 auto; padding-inline: var(--margem); }
.so-leitor {
  position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap;
}

@media (max-width: 640px) {
  :root { --margem: 16px; }
}
```

`apps/site/src/app/layout.tsx` (versão mínima; a Task 4 substitui):

```tsx
import type { ReactNode } from 'react';
import '@/estilos/tokens.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
```

`apps/site/src/app/page.tsx` (versão mínima; a Task 6 substitui):

```tsx
export default function PaginaInicial() {
  return <main className="conteudo"><h1>Site em construção</h1></main>;
}
```

- [ ] **Step 10: Build**

Run: `npm run build --workspace apps/site`
Expected: `Compiled successfully` e a rota `/` listada.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore apps/site
git commit -m "Site: esqueleto Next.js em apps/site, tokens e funções de formato" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 3: Cliente da API, tipos e normalização

**Files:**
- Create: `apps/site/src/lib/api/tipos.ts`, `normalizar.ts`, `cliente.ts`, `catalogo.ts`
- Test: `apps/site/src/lib/api/normalizar.test.ts`, `apps/site/src/lib/api/cliente.test.ts`

**Interfaces:**
- Consumes: rotas da API (`/config`, `/home`, `/categorias`, `/marcas`, `/produtos`, `/produtos/:id`, `/produtos/:id/relacionados`, `/carrinho`).
- Produces (de `tipos.ts`): `Produto`, `Banner`, `Patrocinador`, `Prateleira`, `Home`, `Categoria`, `Marca`, `ConfigLoja`, `PaginaProdutos`, `Relacionados`, `ItemCarrinho`, `Carrinho`.
- Produces (de `cliente.ts`): `class ErroApi extends Error { status: number }`; `chamarApi<T>(caminho: string, op?: { metodo?, corpo?, revalidar?: number, deviceId?: string }): Promise<T>`.
- Produces (de `normalizar.ts`): `normalizarProduto`, `normalizarHome`, `normalizarCategoria`, `normalizarConfig`, `normalizarCarrinho`.
- Produces (de `catalogo.ts`): `buscarConfig()`, `buscarHome()`, `buscarCategorias()`, `buscarMarcas(categoriaId?)`, `buscarProdutos(f)`, `buscarProduto(id)`, `buscarRelacionados(id)`. Todas com cache de 60 s.

- [ ] **Step 1: Criar os tipos**

`apps/site/src/lib/api/tipos.ts`:

```ts
export interface Imagem { url: string; miniatura: string | null }

export interface Produto {
  id: string;
  sku: string | null;
  ean: string | null;
  nome: string;
  descricao: string | null;
  unidadeVenda: string;
  qtdPorEmbalagem: number;
  qtdMinima: number;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
  dataValidade: string | null;
  marca: string | null;
  marcaId: string | null;
  categoria: string | null;
  categoriaId: string | null;
  estoque: number;
  precoTabela: number | null;
  precoPromocional: number | null;
  /** Preço final da embalagem de venda (promoção vence tabela). Nulo = sem preço cadastrado. */
  preco: number | null;
  imagens: Imagem[];
}

export interface Banner {
  id: string;
  titulo: string | null;
  imagemUrl: string;
  destinoTipo: string | null;
  destinoId: string | null;
}

export interface Patrocinador {
  tipo: 'patrocinador';
  id: string;
  nome: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  produtos: Produto[];
}

export interface PrateleiraCategoria {
  tipo: 'categoria';
  categoriaId: string;
  nome: string;
  produtos: Produto[];
}

export type Prateleira = PrateleiraCategoria | Patrocinador;

export interface Home {
  banners: Banner[];
  promocoes: Produto[];
  maisVendidos: Produto[];
  vencimentoProximo: Produto[];
  prateleiras: Prateleira[];
  patrocinadoresTopo: Patrocinador[];
  patrocinadoresOfertas: Patrocinador[];
}

export interface Categoria {
  id: string;
  paiId: string | null;
  nome: string;
  imagemUrl: string | null;
}

export interface Marca { id: string; nome: string; produtos: number }

export interface ConfigLoja {
  appNome: string;
  distribuidora: string;
  corPrimaria: string | null;
  logoUrl: string | null;
  limiteEstoqueBaixo: number;
  contatoWhatsapp: string | null;
}

export interface PaginaProdutos { dados: Produto[]; pagina: number; temMais: boolean }

export interface Relacionados { similares: Produto[]; pecaTambem: Produto[] }

export interface ItemCarrinho {
  produtoId: string;
  nome: string;
  quantidade: number;
  unidadeVenda: string;
  qtdMinima: number;
  estoque: number;
  imagemUrl: string | null;
  precoAtual: number | null;
}

export interface Carrinho { itens: ItemCarrinho[]; subtotal: number }
```

- [ ] **Step 2: Escrever os testes que falham**

`apps/site/src/lib/api/normalizar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizarCarrinho, normalizarConfig, normalizarHome, normalizarProduto } from './normalizar';

const BRUTO = {
  id: 'p1', sku: '123', ean: null, nome: 'Detergente', descricao: null, unidade_venda: 'CX',
  qtd_por_embalagem: 24, qtd_minima: 1, desconto_qtd_minima: 4, desconto_qtd_preco: '49.90',
  data_validade: '2026-12-05T03:00:00.000Z', marca: 'Ypê', marca_id: 'm1', categoria: 'Limpeza',
  categoria_id: 'c1', estoque: '12.000', preco_tabela: '52.80', preco_promocional: null, preco: '52.80',
  imagens: [{ url: 'http://x/a.jpg', miniatura: 'http://x/a_m.jpg', ordem: 0 }],
};

describe('normalizarProduto', () => {
  it('converte numeric em número e renomeia para camelCase', () => {
    const p = normalizarProduto(BRUTO);
    expect(p.preco).toBe(52.8);
    expect(p.precoTabela).toBe(52.8);
    expect(p.precoPromocional).toBeNull();
    expect(p.estoque).toBe(12);
    expect(p.descontoQtdPreco).toBe(49.9);
    expect(p.unidadeVenda).toBe('CX');
    expect(p.marcaId).toBe('m1');
    expect(p.imagens).toEqual([{ url: 'http://x/a.jpg', miniatura: 'http://x/a_m.jpg' }]);
  });

  it('aguenta produto enxuto de vitrine patrocinada', () => {
    const p = normalizarProduto({ id: 'p2', nome: 'X', unidade_venda: 'UN', qtd_por_embalagem: 1, preco: null, imagens: null });
    expect(p.preco).toBeNull();
    expect(p.imagens).toEqual([]);
    expect(p.qtdMinima).toBe(1);
    expect(p.estoque).toBe(0);
    expect(p.categoria).toBeNull();
  });
});

describe('normalizarHome', () => {
  it('normaliza produtos dentro de prateleiras e patrocinadores', () => {
    const h = normalizarHome({
      banners: [{ id: 'b1', titulo: 'T', imagem_url: 'http://x/b.jpg', destino_tipo: 'produto', destino_id: 'p1' }],
      promocoes: [BRUTO], maisVendidos: [], vencimentoProximo: [],
      prateleiras: [
        { tipo: 'categoria', categoriaId: 'c1', nome: 'Limpeza', produtos: [BRUTO] },
        { tipo: 'patrocinador', id: 's1', nome: 'Marca', logoUrl: null, bannerUrl: 'http://x/s.jpg', produtos: [BRUTO] },
      ],
      patrocinadoresTopo: [], patrocinadoresOfertas: [],
    });
    expect(h.banners[0]).toEqual({ id: 'b1', titulo: 'T', imagemUrl: 'http://x/b.jpg', destinoTipo: 'produto', destinoId: 'p1' });
    expect(h.promocoes[0].preco).toBe(52.8);
    expect(h.prateleiras[0].produtos[0].preco).toBe(52.8);
    expect(h.prateleiras[1].tipo).toBe('patrocinador');
  });

  it('campos ausentes viram listas vazias', () => {
    const h = normalizarHome({});
    expect(h.banners).toEqual([]);
    expect(h.prateleiras).toEqual([]);
    expect(h.patrocinadoresTopo).toEqual([]);
  });
});

describe('normalizarConfig', () => {
  it('lê tema e configurações com valores padrão seguros', () => {
    const c = normalizarConfig({
      appNome: 'CAHU Delivery', distribuidora: 'CAHU',
      tema: { cor_primaria: '#FFD500', logo_url: 'http://x/l.png' },
      configuracoes: { limite_estoque_baixo: '5', contato_whatsapp: '(81) 99999-0000' },
    });
    expect(c).toEqual({
      appNome: 'CAHU Delivery', distribuidora: 'CAHU', corPrimaria: '#FFD500',
      logoUrl: 'http://x/l.png', limiteEstoqueBaixo: 5, contatoWhatsapp: '(81) 99999-0000',
    });
    const vazio = normalizarConfig({ appNome: 'A', distribuidora: 'B', tema: null, configuracoes: {} });
    expect(vazio.corPrimaria).toBeNull();
    expect(vazio.limiteEstoqueBaixo).toBe(0);
    expect(vazio.contatoWhatsapp).toBeNull();
  });
});

describe('normalizarCarrinho', () => {
  it('converte quantidade e preço', () => {
    const c = normalizarCarrinho({
      itens: [{ produto_id: 'p1', quantidade: '2', nome: 'Detergente', unidade_venda: 'CX', qtd_minima: 1, estoque: '12', imagem_url: null, preco_atual: '52.80' }],
      subtotal: 105.6,
    });
    expect(c.itens[0]).toEqual({
      produtoId: 'p1', nome: 'Detergente', quantidade: 2, unidadeVenda: 'CX', qtdMinima: 1, estoque: 12, imagemUrl: null, precoAtual: 52.8,
    });
    expect(c.subtotal).toBe(105.6);
  });
});
```

`apps/site/src/lib/api/cliente.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chamarApi, ErroApi } from './cliente';

const resposta = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo }) as Response;

describe('chamarApi', () => {
  beforeEach(() => {
    process.env.API_URL = 'http://api.teste/v1/';
    process.env.TENANT = 'cahu';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('manda X-Tenant, usa a URL base e devolve o JSON', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchFalso);
    const r = await chamarApi<{ ok: number }>('/home', { revalidar: 60 });
    expect(r).toEqual({ ok: 1 });
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit & { next?: { revalidate: number } }];
    expect(url).toBe('http://api.teste/v1/home');
    expect((init.headers as Record<string, string>)['X-Tenant']).toBe('cahu');
    expect(init.next).toEqual({ revalidate: 60 });
  });

  it('sem revalidar não usa cache; com deviceId e corpo manda os cabeçalhos', async () => {
    const fetchFalso = vi.fn(async () => resposta(200, {}));
    vi.stubGlobal('fetch', fetchFalso);
    await chamarApi('/carrinho/itens', { metodo: 'PUT', corpo: { a: 1 }, deviceId: 'dev-1' });
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    const h = init.headers as Record<string, string>;
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"a":1}');
    expect(h['X-Device-Id']).toBe('dev-1');
    expect(h['Content-Type']).toBe('application/json');
  });

  it('erro da API vira ErroApi com a mensagem dela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(404, { message: 'Produto não encontrado' })));
    await expect(chamarApi('/produtos/x')).rejects.toMatchObject({ status: 404, message: 'Produto não encontrado' });
  });

  it('mensagem em lista (validação do Nest) é juntada', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resposta(400, { message: ['a', 'b'] })));
    await expect(chamarApi('/x')).rejects.toMatchObject({ status: 400, message: 'a. b' });
  });

  it('API fora do ar vira ErroApi 503', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const erro = await chamarApi('/home').catch((e) => e);
    expect(erro).toBeInstanceOf(ErroApi);
    expect(erro.status).toBe(503);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./normalizar` e `./cliente` não existem).

- [ ] **Step 4: Implementar `normalizar.ts`**

`apps/site/src/lib/api/normalizar.ts`:

```ts
import type {
  Banner, Carrinho, Categoria, ConfigLoja, Home, Patrocinador, Prateleira, Produto,
} from './tipos';

type Bruto = Record<string, unknown>;

const numOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown, padrao = 0): number => numOuNulo(v) ?? padrao;
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const lista = (v: unknown): Bruto[] => (Array.isArray(v) ? (v as Bruto[]) : []);

export function normalizarProduto(b: Bruto): Produto {
  return {
    id: String(b.id),
    sku: txt(b.sku),
    ean: txt(b.ean),
    nome: String(b.nome ?? ''),
    descricao: txt(b.descricao),
    unidadeVenda: String(b.unidade_venda ?? 'UN'),
    qtdPorEmbalagem: num(b.qtd_por_embalagem, 1),
    qtdMinima: Math.max(1, num(b.qtd_minima, 1)),
    descontoQtdMinima: numOuNulo(b.desconto_qtd_minima),
    descontoQtdPreco: numOuNulo(b.desconto_qtd_preco),
    dataValidade: txt(b.data_validade),
    marca: txt(b.marca),
    marcaId: txt(b.marca_id),
    categoria: txt(b.categoria),
    categoriaId: txt(b.categoria_id),
    estoque: num(b.estoque),
    precoTabela: numOuNulo(b.preco_tabela),
    precoPromocional: numOuNulo(b.preco_promocional),
    preco: numOuNulo(b.preco),
    imagens: lista(b.imagens)
      .filter((i) => typeof i.url === 'string')
      .map((i) => ({ url: String(i.url), miniatura: txt(i.miniatura) })),
  };
}

const produtos = (v: unknown): Produto[] => lista(v).map(normalizarProduto);

function normalizarBanner(b: Bruto): Banner {
  return {
    id: String(b.id),
    titulo: txt(b.titulo),
    imagemUrl: String(b.imagem_url ?? ''),
    destinoTipo: txt(b.destino_tipo),
    destinoId: txt(b.destino_id),
  };
}

function normalizarPatrocinador(b: Bruto): Patrocinador {
  return {
    tipo: 'patrocinador',
    id: String(b.id),
    nome: String(b.nome ?? ''),
    logoUrl: txt(b.logoUrl),
    bannerUrl: txt(b.bannerUrl),
    produtos: produtos(b.produtos),
  };
}

function normalizarPrateleira(b: Bruto): Prateleira {
  if (b.tipo === 'patrocinador') return normalizarPatrocinador(b);
  return {
    tipo: 'categoria',
    categoriaId: String(b.categoriaId),
    nome: String(b.nome ?? ''),
    produtos: produtos(b.produtos),
  };
}

export function normalizarHome(b: Bruto): Home {
  return {
    banners: lista(b.banners).map(normalizarBanner).filter((x) => x.imagemUrl),
    promocoes: produtos(b.promocoes),
    maisVendidos: produtos(b.maisVendidos),
    vencimentoProximo: produtos(b.vencimentoProximo),
    prateleiras: lista(b.prateleiras).map(normalizarPrateleira),
    patrocinadoresTopo: lista(b.patrocinadoresTopo).map(normalizarPatrocinador),
    patrocinadoresOfertas: lista(b.patrocinadoresOfertas).map(normalizarPatrocinador),
  };
}

export function normalizarCategoria(b: Bruto): Categoria {
  return { id: String(b.id), paiId: txt(b.pai_id), nome: String(b.nome ?? ''), imagemUrl: txt(b.imagem_url) };
}

export function normalizarConfig(b: Bruto): ConfigLoja {
  const tema = (b.tema ?? {}) as Bruto;
  const cfg = (b.configuracoes ?? {}) as Bruto;
  return {
    appNome: String(b.appNome ?? ''),
    distribuidora: String(b.distribuidora ?? ''),
    corPrimaria: txt(tema.cor_primaria),
    logoUrl: txt(tema.logo_url),
    limiteEstoqueBaixo: num(cfg.limite_estoque_baixo),
    contatoWhatsapp: txt(cfg.contato_whatsapp),
  };
}

export function normalizarCarrinho(b: Bruto): Carrinho {
  return {
    itens: lista(b.itens).map((i) => ({
      produtoId: String(i.produto_id),
      nome: String(i.nome ?? ''),
      quantidade: num(i.quantidade),
      unidadeVenda: String(i.unidade_venda ?? 'UN'),
      qtdMinima: Math.max(1, num(i.qtd_minima, 1)),
      estoque: num(i.estoque),
      imagemUrl: txt(i.imagem_url),
      precoAtual: numOuNulo(i.preco_atual),
    })),
    subtotal: num(b.subtotal),
  };
}
```

- [ ] **Step 5: Implementar `cliente.ts`**

`apps/site/src/lib/api/cliente.ts`:

```ts
export class ErroApi extends Error {
  constructor(public readonly status: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

export interface OpcoesApi {
  metodo?: 'GET' | 'PUT' | 'POST' | 'DELETE';
  corpo?: unknown;
  /** Segundos de cache. Ausente = sem cache (dados do cliente). */
  revalidar?: number;
  deviceId?: string;
}

const base = () => (process.env.API_URL ?? 'http://localhost:3000/v1').replace(/\/+$/, '');
const tenant = () => process.env.TENANT ?? 'cahu';

/** Única porta do site para a API /v1. Só roda no servidor. */
export async function chamarApi<T>(caminho: string, op: OpcoesApi = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Tenant': tenant(), Accept: 'application/json' };
  if (op.deviceId) headers['X-Device-Id'] = op.deviceId;
  if (op.corpo !== undefined) headers['Content-Type'] = 'application/json';

  const init: RequestInit & { next?: { revalidate: number } } = {
    method: op.metodo ?? 'GET',
    headers,
    body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined,
  };
  if (op.revalidar !== undefined) init.next = { revalidate: op.revalidar };
  else init.cache = 'no-store';

  let resp: Response;
  try {
    resp = await fetch(`${base()}${caminho}`, init);
  } catch {
    throw new ErroApi(503, 'Não foi possível falar com o servidor. Tente novamente.');
  }

  if (!resp.ok) {
    let mensagem = 'Erro inesperado. Tente novamente.';
    try {
      const j = (await resp.json()) as { message?: unknown };
      const m = Array.isArray(j?.message) ? j.message.join('. ') : j?.message;
      if (typeof m === 'string' && m) mensagem = m;
    } catch {
      // corpo não era JSON: fica a mensagem padrão
    }
    throw new ErroApi(resp.status, mensagem);
  }
  return (await resp.json()) as T;
}
```

- [ ] **Step 6: Implementar `catalogo.ts`**

`apps/site/src/lib/api/catalogo.ts`:

```ts
import { chamarApi } from './cliente';
import { normalizarCategoria, normalizarConfig, normalizarHome, normalizarProduto } from './normalizar';
import type { Categoria, ConfigLoja, Home, Marca, PaginaProdutos, Produto, Relacionados } from './tipos';

/** Cache do catálogo: o preço que o Dlinks atualiza aparece em até 1 minuto. */
const REVALIDAR = 60;
export const ITENS_POR_PAGINA = 24;

type Bruto = Record<string, unknown>;

export async function buscarConfig(): Promise<ConfigLoja> {
  return normalizarConfig(await chamarApi<Bruto>('/config', { revalidar: REVALIDAR }));
}

export async function buscarHome(): Promise<Home> {
  return normalizarHome(await chamarApi<Bruto>('/home', { revalidar: REVALIDAR }));
}

export async function buscarCategorias(): Promise<Categoria[]> {
  return (await chamarApi<Bruto[]>('/categorias', { revalidar: REVALIDAR })).map(normalizarCategoria);
}

export async function buscarMarcas(categoriaId?: string): Promise<Marca[]> {
  const q = categoriaId ? `?categoria=${categoriaId}` : '';
  const linhas = await chamarApi<Bruto[]>(`/marcas${q}`, { revalidar: REVALIDAR });
  return linhas.map((m) => ({ id: String(m.id), nome: String(m.nome ?? ''), produtos: Number(m.produtos) || 0 }));
}

export interface FiltroBusca {
  categoria?: string;
  marca?: string;
  busca?: string;
  promocao?: boolean;
  pagina: number;
  ordem: string;
}

export async function buscarProdutos(f: FiltroBusca): Promise<PaginaProdutos> {
  const q = new URLSearchParams({ pagina: String(f.pagina), limite: String(ITENS_POR_PAGINA), ordem: f.ordem });
  if (f.categoria) q.set('categoria', f.categoria);
  if (f.marca) q.set('marca', f.marca);
  if (f.busca) q.set('busca', f.busca);
  if (f.promocao) q.set('promocao', 'true');
  const r = await chamarApi<{ dados: Bruto[]; pagina: number; temMais?: boolean }>(`/produtos?${q}`, { revalidar: REVALIDAR });
  return { dados: r.dados.map(normalizarProduto), pagina: r.pagina, temMais: r.temMais === true };
}

export async function buscarProduto(id: string): Promise<Produto> {
  return normalizarProduto(await chamarApi<Bruto>(`/produtos/${id}`, { revalidar: REVALIDAR }));
}

export async function buscarRelacionados(id: string): Promise<Relacionados> {
  const r = await chamarApi<{ similares: Bruto[]; pecaTambem: Bruto[] }>(`/produtos/${id}/relacionados`, { revalidar: REVALIDAR });
  return { similares: (r.similares ?? []).map(normalizarProduto), pecaTambem: (r.pecaTambem ?? []).map(normalizarProduto) };
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS (formato, normalizar, cliente).

- [ ] **Step 8: Commit**

```bash
git add apps/site/src/lib/api
git commit -m "Site: cliente da API, tipos e normalização do catálogo" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 4: Moldura do site: layout, cabeçalho, rodapé e bloqueio de indexação

**Files:**
- Create: `apps/site/src/lib/site.ts`, `apps/site/src/lib/site.test.ts`
- Create: `apps/site/src/componentes/Cabecalho.tsx`, `Cabecalho.module.css`, `Rodape.tsx`, `Rodape.module.css`
- Create: `apps/site/src/app/robots.ts`
- Modify: `apps/site/src/app/layout.tsx` (substituir inteiro)

**Interfaces:**
- Consumes: `buscarConfig()`, `buscarCategorias()`, `caminhoCategoria()`, tipos `ConfigLoja`, `Categoria`.
- Produces: `siteUrl(): string`, `indexavel(): boolean`, `linkWhatsapp(numero: string | null): string | null`; componentes `<Cabecalho config categorias />` e `<Rodape config />`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/site/src/lib/site.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { indexavel, linkWhatsapp, siteUrl } from './site';

afterEach(() => {
  delete process.env.SITE_URL;
  delete process.env.SITE_INDEXAVEL;
});

describe('site', () => {
  it('siteUrl sem barra no fim, com padrão local', () => {
    expect(siteUrl()).toBe('http://localhost:3010');
    process.env.SITE_URL = 'https://loja.exemplo.com.br/';
    expect(siteUrl()).toBe('https://loja.exemplo.com.br');
  });

  it('só é indexável com SITE_INDEXAVEL=true', () => {
    expect(indexavel()).toBe(false);
    process.env.SITE_INDEXAVEL = 'false';
    expect(indexavel()).toBe(false);
    process.env.SITE_INDEXAVEL = 'true';
    expect(indexavel()).toBe(true);
  });

  it('linkWhatsapp usa só os dígitos e põe 55 quando falta', () => {
    expect(linkWhatsapp('(81) 99999-0000')).toBe('https://wa.me/5581999990000');
    expect(linkWhatsapp('5581999990000')).toBe('https://wa.me/5581999990000');
    expect(linkWhatsapp(null)).toBeNull();
    expect(linkWhatsapp('abc')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./site` não existe).

- [ ] **Step 3: Implementar `site.ts` e `robots.ts`**

`apps/site/src/lib/site.ts`:

```ts
export function siteUrl(): string {
  return (process.env.SITE_URL ?? 'http://localhost:3010').replace(/\/+$/, '');
}

/** Enquanto o endereço for provisório o Google não deve indexar. */
export function indexavel(): boolean {
  return process.env.SITE_INDEXAVEL === 'true';
}

export function linkWhatsapp(numero: string | null): string | null {
  const digitos = (numero ?? '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return `https://wa.me/${digitos.startsWith('55') && digitos.length >= 12 ? digitos : `55${digitos}`}`;
}
```

`apps/site/src/app/robots.ts`:

```ts
import type { MetadataRoute } from 'next';
import { indexavel } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  if (!indexavel()) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/carrinho', '/busca'] } };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS.

- [ ] **Step 5: Cabeçalho**

`apps/site/src/componentes/Cabecalho.tsx`:

```tsx
import Link from 'next/link';
import type { Categoria, ConfigLoja } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';
import { linkWhatsapp } from '@/lib/site';
import estilos from './Cabecalho.module.css';

export function Cabecalho({ config, categorias }: { config: ConfigLoja; categorias: Categoria[] }) {
  const raizes = categorias.filter((c) => !c.paiId);
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <header>
      {whatsapp && (
        <div className={estilos.faixa}>
          <div className={`conteudo ${estilos.faixaLinha}`}>
            <span>Atendimento: {config.contatoWhatsapp}</span>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">Falar com a distribuidora</a>
          </div>
        </div>
      )}
      <div className={`conteudo ${estilos.principal}`}>
        <Link href="/" className={estilos.marca} aria-label={`${config.distribuidora}, página inicial`}>
          {config.logoUrl
            ? <img src={config.logoUrl} alt="" className={estilos.logo} />
            : <span className={estilos.nome}>{config.distribuidora}</span>}
        </Link>
        <form action="/busca" role="search" className={estilos.busca}>
          <label htmlFor="campo-busca" className="so-leitor">Buscar produto</label>
          <input id="campo-busca" name="q" type="search" placeholder="Buscar produto ou marca" required minLength={2} />
          <button type="submit" aria-label="Buscar">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
            </svg>
          </button>
        </form>
        <Link href="/carrinho" className={estilos.carrinho}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4h2l2.4 11h10.2L20 7H6.2" /><circle cx="9" cy="19" r="1.5" /><circle cx="17" cy="19" r="1.5" />
          </svg>
          <span>Carrinho</span>
        </Link>
      </div>
      <nav aria-label="Categorias" className={estilos.nav}>
        <div className={`conteudo ${estilos.navLinha}`}>
          {raizes.map((c) => (
            <Link key={c.id} href={caminhoCategoria(c)}>{c.nome}</Link>
          ))}
          <Link href="/ofertas" className={estilos.ofertas}>Ofertas da semana</Link>
        </div>
      </nav>
    </header>
  );
}
```

`apps/site/src/componentes/Cabecalho.module.css`:

```css
.faixa { border-bottom: 1px solid var(--linha); font-size: 13px; color: var(--tinta-suave); padding-block: 10px; }
.faixaLinha { display: flex; flex-wrap: wrap; gap: 6px 24px; justify-content: space-between; }
.principal { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 40px; padding-block: 20px; }
.marca { display: flex; align-items: center; text-decoration: none; min-height: 44px; }
.logo { height: 44px; width: auto; }
.nome { font-family: var(--fonte-titulo), sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -0.02em; }
.busca {
  flex: 999 1 280px; min-width: 0; display: flex; align-items: center; gap: 8px;
  height: 48px; padding: 0 6px 0 20px; background: var(--fundo-suave); border-radius: var(--raio-pilula);
}
.busca input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 15px; }
.busca button {
  width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
  color: var(--tinta-suave); cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.busca:focus-within { outline: 2px solid var(--tinta); outline-offset: 2px; }
.carrinho {
  display: inline-flex; align-items: center; gap: 10px; height: 48px; padding: 0 20px;
  border-radius: var(--raio-pilula); background: var(--tinta); color: #ffffff;
  font-weight: 500; text-decoration: none;
}
.nav { border-block: 1px solid var(--linha); }
.navLinha { display: flex; flex-wrap: wrap; gap: 0 36px; font-weight: 500; }
.navLinha a { padding-block: 16px; text-decoration: none; }
.navLinha a:hover { text-decoration: underline; }
.ofertas { margin-left: auto; font-weight: 600; }
@media (max-width: 640px) {
  .ofertas { margin-left: 0; }
  .navLinha { gap: 0 20px; }
}
```

- [ ] **Step 6: Rodapé**

`apps/site/src/componentes/Rodape.tsx`:

```tsx
import type { ConfigLoja } from '@/lib/api/tipos';
import { linkWhatsapp } from '@/lib/site';
import estilos from './Rodape.module.css';

export function Rodape({ config }: { config: ConfigLoja }) {
  const whatsapp = linkWhatsapp(config.contatoWhatsapp);
  return (
    <footer className={estilos.rodape}>
      <div className={`conteudo ${estilos.linha}`}>
        <div><strong>{config.distribuidora}</strong></div>
        {whatsapp && (
          <div>Atendimento: <a href={whatsapp} target="_blank" rel="noopener noreferrer">{config.contatoWhatsapp}</a></div>
        )}
        <div>Também no celular: <strong>app {config.appNome}</strong></div>
      </div>
    </footer>
  );
}
```

`apps/site/src/componentes/Rodape.module.css`:

```css
.rodape { margin-top: 88px; border-top: 1px solid var(--linha); padding-block: 40px; font-size: 14px; color: var(--tinta-suave); }
.linha { display: flex; flex-wrap: wrap; gap: 16px 56px; justify-content: space-between; }
.rodape strong { color: var(--tinta); }
```

- [ ] **Step 7: Layout definitivo**

Substituir `apps/site/src/app/layout.tsx` inteiro por:

```tsx
import type { Metadata } from 'next';
import { Inter, Manrope } from 'next/font/google';
import type { CSSProperties, ReactNode } from 'react';
import { Cabecalho } from '@/componentes/Cabecalho';
import { Rodape } from '@/componentes/Rodape';
import { buscarCategorias, buscarConfig } from '@/lib/api/catalogo';
import { indexavel, siteUrl } from '@/lib/site';
import '@/estilos/tokens.css';

const fonteTexto = Inter({ subsets: ['latin'], variable: '--fonte-texto', display: 'swap' });
const fonteTitulo = Manrope({ subsets: ['latin'], weight: ['700', '800'], variable: '--fonte-titulo', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const config = await buscarConfig();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: config.distribuidora, template: `%s | ${config.distribuidora}` },
    description: `Compre no atacado direto da ${config.distribuidora}, com preço por caixa e por unidade.`,
    robots: indexavel() ? undefined : { index: false, follow: false },
  };
}

export default async function Layout({ children }: { children: ReactNode }) {
  const [config, categorias] = await Promise.all([buscarConfig(), buscarCategorias()]);
  // Cor de destaque do tenant (white label). Sem cor cadastrada, vale a do tokens.css.
  const tema = (config.corPrimaria ? { '--destaque': config.corPrimaria } : {}) as CSSProperties;
  return (
    <html lang="pt-BR" className={`${fonteTexto.variable} ${fonteTitulo.variable}`}>
      <body style={tema}>
        <Cabecalho config={config} categorias={categorias} />
        <main>{children}</main>
        <Rodape config={config} />
      </body>
    </html>
  );
}
```

- [ ] **Step 8: Conferir no navegador**

Com a API rodando (`npm run api`), em outro terminal: `npm run site`. Abrir `http://localhost:3010`.
Expected: cabeçalho com logo ou nome da distribuidora, busca, botão Carrinho, as categorias da API na barra e o rodapé. `curl -s http://localhost:3010/robots.txt` devolve `Disallow: /`, e o HTML da página tem `<meta name="robots" content="noindex, nofollow"`.

- [ ] **Step 9: Build e commit**

Run: `npm run build --workspace apps/site` (com a API no ar). Expected: `Compiled successfully`.

```bash
git add apps/site/src
git commit -m "Site: layout com cabeçalho, rodapé, tema do tenant e bloqueio de indexação" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 5: Carrinho do visitante

**Files:**
- Create: `apps/site/src/lib/sessao/dispositivo.ts`, `origem.ts`, `item.ts`
- Test: `apps/site/src/lib/sessao/sessao.test.ts`
- Create: `apps/site/src/app/api/carrinho/route.ts`, `apps/site/src/app/api/carrinho/itens/route.ts`
- Create: `apps/site/src/componentes/CarrinhoProvider.tsx`, `BotaoAdicionar.tsx`, `BotaoAdicionar.module.css`, `ContadorCarrinho.tsx`
- Create: `apps/site/src/app/carrinho/page.tsx`, `apps/site/src/app/carrinho/carrinho.module.css`, `apps/site/src/componentes/ItensCarrinho.tsx`
- Modify: `apps/site/src/app/layout.tsx`, `apps/site/src/componentes/Cabecalho.tsx`, `apps/site/src/estilos/tokens.css`

**Interfaces:**
- Consumes: `chamarApi`, `ErroApi`, `normalizarCarrinho`, tipos `Carrinho`, `ItemCarrinho`, `UUID_INTEIRO`.
- Produces:
  - `origemConfere(origin: string | null, host: string | null): boolean`
  - `validarItem(corpo: unknown): { produtoId: string; quantidade: number } | null`
  - `COOKIE_DISPOSITIVO = 'fc_dispositivo'`, `lerDispositivo(): Promise<string | null>`, `garantirDispositivo(): Promise<string>`
  - `GET /api/carrinho` → `Carrinho`; `PUT /api/carrinho/itens` com `{ produtoId, quantidade }` → `Carrinho` ou `{ mensagem }` com status de erro
  - `useCarrinho(): { carrinho: Carrinho; totalVolumes: number; quantidadeDe(id: string): number; definir(id: string, qtd: number): Promise<void>; ocupado: boolean }`
  - `<BotaoAdicionar produtoId qtdMinima nome />`, `<ContadorCarrinho />`

- [ ] **Step 1: Escrever o teste que falha**

`apps/site/src/lib/sessao/sessao.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validarItem } from './item';
import { origemConfere } from './origem';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';

describe('origemConfere', () => {
  it('aceita só quando o host do Origin é o host da requisição', () => {
    expect(origemConfere('https://loja.exemplo.com', 'loja.exemplo.com')).toBe(true);
    expect(origemConfere('http://localhost:3010', 'localhost:3010')).toBe(true);
    expect(origemConfere('https://outro.com', 'loja.exemplo.com')).toBe(false);
    expect(origemConfere(null, 'loja.exemplo.com')).toBe(false);
    expect(origemConfere('https://loja.exemplo.com', null)).toBe(false);
    expect(origemConfere('nao-e-url', 'loja.exemplo.com')).toBe(false);
  });
});

describe('validarItem', () => {
  it('aceita produtoId uuid e quantidade inteira de 0 a 9999', () => {
    expect(validarItem({ produtoId: ID, quantidade: 3 })).toEqual({ produtoId: ID, quantidade: 3 });
    expect(validarItem({ produtoId: ID, quantidade: 0 })).toEqual({ produtoId: ID, quantidade: 0 });
  });
  it('recusa o resto', () => {
    expect(validarItem(null)).toBeNull();
    expect(validarItem({ produtoId: 'x', quantidade: 1 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: 1.5 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: -1 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: 10000 })).toBeNull();
    expect(validarItem({ produtoId: ID, quantidade: '2' })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./item` e `./origem` não existem).

- [ ] **Step 3: Implementar a sessão**

`apps/site/src/lib/sessao/origem.ts`:

```ts
/** Proteção contra envio forjado: quem altera dados tem que vir do próprio site. */
export function origemConfere(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
```

`apps/site/src/lib/sessao/item.ts`:

```ts
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export function validarItem(corpo: unknown): { produtoId: string; quantidade: number } | null {
  if (!corpo || typeof corpo !== 'object') return null;
  const { produtoId, quantidade } = corpo as Record<string, unknown>;
  if (typeof produtoId !== 'string' || !UUID_INTEIRO.test(produtoId)) return null;
  if (typeof quantidade !== 'number' || !Number.isInteger(quantidade) || quantidade < 0 || quantidade > 9999) return null;
  return { produtoId, quantidade };
}
```

`apps/site/src/lib/sessao/dispositivo.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

export const COOKIE_DISPOSITIVO = 'fc_dispositivo';
const UM_ANO = 60 * 60 * 24 * 365;

/** Identificador do carrinho anônimo (mesmo mecanismo X-Device-Id do app). Nulo = visitante sem carrinho. */
export async function lerDispositivo(): Promise<string | null> {
  return (await cookies()).get(COOKIE_DISPOSITIVO)?.value ?? null;
}

/** Só chamar em rota /api (cookies não podem ser gravados durante a renderização de página). */
export async function garantirDispositivo(): Promise<string> {
  const jar = await cookies();
  const atual = jar.get(COOKIE_DISPOSITIVO)?.value;
  if (atual) return atual;
  const novo = randomUUID();
  jar.set(COOKIE_DISPOSITIVO, novo, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: UM_ANO,
  });
  return novo;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS.

- [ ] **Step 5: Rotas `/api/carrinho`**

`apps/site/src/app/api/carrinho/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { lerDispositivo } from '@/lib/sessao/dispositivo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const deviceId = await lerDispositivo();
  // Visitante que nunca adicionou nada: não cria linha de carrinho na API.
  if (!deviceId) return NextResponse.json({ itens: [], subtotal: 0 });
  try {
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho', { deviceId });
    return NextResponse.json(normalizarCarrinho(bruto));
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status });
  }
}
```

`apps/site/src/app/api/carrinho/itens/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { chamarApi, ErroApi } from '@/lib/api/cliente';
import { normalizarCarrinho } from '@/lib/api/normalizar';
import { garantirDispositivo } from '@/lib/sessao/dispositivo';
import { validarItem } from '@/lib/sessao/item';
import { origemConfere } from '@/lib/sessao/origem';

export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!origemConfere(req.headers.get('origin'), host)) {
    return NextResponse.json({ mensagem: 'Origem não permitida.' }, { status: 403 });
  }
  const item = validarItem(await req.json().catch(() => null));
  if (!item) return NextResponse.json({ mensagem: 'Item inválido.' }, { status: 400 });

  try {
    const deviceId = await garantirDispositivo();
    const bruto = await chamarApi<Record<string, unknown>>('/carrinho/itens', { metodo: 'PUT', corpo: item, deviceId });
    return NextResponse.json(normalizarCarrinho(bruto));
  } catch (e) {
    const erro = e instanceof ErroApi ? e : new ErroApi(500, 'Erro inesperado. Tente novamente.');
    return NextResponse.json({ mensagem: erro.message }, { status: erro.status });
  }
}
```

- [ ] **Step 6: Provider, botão e contador**

`apps/site/src/componentes/CarrinhoProvider.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Carrinho } from '@/lib/api/tipos';

interface ValorCarrinho {
  carrinho: Carrinho;
  totalVolumes: number;
  quantidadeDe: (produtoId: string) => number;
  definir: (produtoId: string, quantidade: number) => Promise<void>;
  ocupado: boolean;
}

const VAZIO: Carrinho = { itens: [], subtotal: 0 };
const Contexto = createContext<ValorCarrinho | null>(null);

export function CarrinhoProvider({ children }: { children: ReactNode }) {
  const [carrinho, setCarrinho] = useState<Carrinho>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/carrinho')
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Carrinho | null) => { if (c) setCarrinho(c); })
      .catch(() => { /* sem carrinho por enquanto; o próximo clique tenta de novo */ });
  }, []);

  const definir = useCallback(async (produtoId: string, quantidade: number) => {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/carrinho/itens', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtoId, quantidade }),
      });
      const corpo = await r.json();
      if (r.ok) setCarrinho(corpo as Carrinho);
      else setErro((corpo as { mensagem?: string }).mensagem ?? 'Não foi possível atualizar o carrinho.');
    } catch {
      setErro('Sem conexão. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }, []);

  const valor = useMemo<ValorCarrinho>(() => ({
    carrinho,
    totalVolumes: carrinho.itens.reduce((t, i) => t + i.quantidade, 0),
    quantidadeDe: (id) => carrinho.itens.find((i) => i.produtoId === id)?.quantidade ?? 0,
    definir,
    ocupado,
  }), [carrinho, definir, ocupado]);

  return (
    <Contexto.Provider value={valor}>
      {children}
      {erro && <div role="alert" className="aviso-flutuante">{erro}</div>}
    </Contexto.Provider>
  );
}

export function useCarrinho(): ValorCarrinho {
  const v = useContext(Contexto);
  if (!v) throw new Error('useCarrinho fora do CarrinhoProvider');
  return v;
}
```

Acrescentar ao final de `apps/site/src/estilos/tokens.css`:

```css
.aviso-flutuante {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 50;
  max-width: calc(100% - 32px); padding: 14px 20px; border-radius: var(--raio-p);
  background: var(--tinta); color: #ffffff; font-size: 14px;
}
```

`apps/site/src/componentes/BotaoAdicionar.tsx`:

```tsx
'use client';

import estilos from './BotaoAdicionar.module.css';
import { useCarrinho } from './CarrinhoProvider';

export function BotaoAdicionar({ produtoId, qtdMinima, nome }: { produtoId: string; qtdMinima: number; nome: string }) {
  const { quantidadeDe, definir, ocupado } = useCarrinho();
  const qtd = quantidadeDe(produtoId);
  const minimo = Math.max(1, qtdMinima);

  if (qtd === 0) {
    return (
      <button type="button" className={estilos.adicionar} disabled={ocupado}
        aria-label={`Adicionar ${nome} ao carrinho`} onClick={() => definir(produtoId, minimo)}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    );
  }
  return (
    <div className={estilos.stepper}>
      {/* Abaixo da quantidade mínima o item sai do carrinho. */}
      <button type="button" disabled={ocupado} aria-label={`Diminuir ${nome}`}
        onClick={() => definir(produtoId, qtd - 1 < minimo ? 0 : qtd - 1)}>−</button>
      <span aria-live="polite" aria-label={`${qtd} no carrinho`}>{qtd}</span>
      <button type="button" disabled={ocupado} aria-label={`Aumentar ${nome}`}
        onClick={() => definir(produtoId, qtd + 1)}>+</button>
    </div>
  );
}
```

`apps/site/src/componentes/BotaoAdicionar.module.css`:

```css
.adicionar {
  width: 48px; height: 48px; flex-shrink: 0; border: 0; border-radius: 50%;
  background: var(--tinta); color: #ffffff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.adicionar:disabled, .stepper button:disabled { opacity: 0.5; cursor: default; }
.stepper {
  display: flex; align-items: center; gap: 2px; flex-shrink: 0;
  background: var(--destaque); color: var(--sobre-destaque); border-radius: var(--raio-pilula); padding: 2px;
}
.stepper button {
  width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent;
  font-size: 20px; line-height: 1; cursor: pointer;
}
.stepper span { min-width: 28px; text-align: center; font-weight: 600; }
```

`apps/site/src/componentes/ContadorCarrinho.tsx`:

```tsx
'use client';

import { useCarrinho } from './CarrinhoProvider';

export function ContadorCarrinho() {
  const { totalVolumes } = useCarrinho();
  if (totalVolumes === 0) return null;
  return (
    <span data-testid="contador-carrinho" aria-label={`${totalVolumes} volumes no carrinho`}
      style={{
        minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, background: 'var(--destaque)',
        color: 'var(--sobre-destaque)', fontSize: 12, fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
      {totalVolumes}
    </span>
  );
}
```

- [ ] **Step 7: Ligar no layout e no cabeçalho**

Em `apps/site/src/app/layout.tsx`: importar `import { CarrinhoProvider } from '@/componentes/CarrinhoProvider';` e trocar o conteúdo do `<body>` por:

```tsx
        <CarrinhoProvider>
          <Cabecalho config={config} categorias={categorias} />
          <main>{children}</main>
          <Rodape config={config} />
        </CarrinhoProvider>
```

Em `apps/site/src/componentes/Cabecalho.tsx`: importar `import { ContadorCarrinho } from './ContadorCarrinho';` e, dentro do `<Link href="/carrinho">`, logo depois de `<span>Carrinho</span>`, acrescentar:

```tsx
          <ContadorCarrinho />
```

- [ ] **Step 8: Página simples do carrinho**

A tela completa de carrinho e o checkout são do Bloco 2. Esta página existe para o botão do cabeçalho não levar a um 404 e para o visitante conferir o que adicionou.

`apps/site/src/componentes/ItensCarrinho.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import { useCarrinho } from './CarrinhoProvider';
import estilos from '@/app/carrinho/carrinho.module.css';

export function ItensCarrinho({ appNome }: { appNome: string }) {
  const { carrinho } = useCarrinho();
  if (carrinho.itens.length === 0) {
    return (
      <div className={estilos.vazio}>
        <p>Seu carrinho está vazio.</p>
        <Link href="/" className={estilos.botao}>Ver produtos</Link>
      </div>
    );
  }
  return (
    <div className={estilos.grade}>
      <ul className={estilos.lista}>
        {carrinho.itens.map((i) => (
          <li key={i.produtoId} className={estilos.item}>
            <div className={estilos.foto}>{i.imagemUrl && <img src={i.imagemUrl} alt="" loading="lazy" />}</div>
            <div className={estilos.info}>
              <strong>{i.nome}</strong>
              <span>{rotuloEmbalagem(i.unidadeVenda, 1)}{i.precoAtual != null && ` · ${formatarPreco(i.precoAtual)} cada`}</span>
            </div>
            <BotaoAdicionar produtoId={i.produtoId} qtdMinima={i.qtdMinima} nome={i.nome} />
            <strong className={estilos.subtotalItem}>
              {i.precoAtual != null ? formatarPreco(i.precoAtual * i.quantidade) : 'Sob consulta'}
            </strong>
          </li>
        ))}
      </ul>
      <aside className={estilos.resumo}>
        <div className={estilos.total}><span>Subtotal</span><strong>{formatarPreco(carrinho.subtotal)}</strong></div>
        <p>O fechamento do pedido pelo site está chegando. Por enquanto, finalize pelo app {appNome}.</p>
      </aside>
    </div>
  );
}
```

`apps/site/src/app/carrinho/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ItensCarrinho } from '@/componentes/ItensCarrinho';
import { buscarConfig } from '@/lib/api/catalogo';
import estilos from './carrinho.module.css';

export const metadata: Metadata = { title: 'Carrinho', robots: { index: false, follow: false } };

export default async function PaginaCarrinho() {
  const config = await buscarConfig();
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <h1>Seu carrinho</h1>
      <ItensCarrinho appNome={config.appNome} />
    </div>
  );
}
```

`apps/site/src/app/carrinho/carrinho.module.css`:

```css
.pagina { padding-block: 48px; display: flex; flex-direction: column; gap: 32px; }
.pagina h1 { font-size: 40px; }
.grade { display: flex; flex-wrap: wrap; gap: 40px 56px; align-items: flex-start; }
.lista { flex: 999 1 520px; min-width: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--linha); }
.item { display: flex; flex-wrap: wrap; align-items: center; gap: 16px 24px; padding-block: 24px; border-bottom: 1px solid var(--linha); }
.foto { width: 88px; height: 88px; flex-shrink: 0; border-radius: var(--raio-p); background: var(--fundo-suave); overflow: hidden; }
.foto img { width: 100%; height: 100%; object-fit: contain; }
.info { flex: 999 1 200px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.info span { font-size: 13px; color: var(--tinta-suave); }
.subtotalItem { min-width: 110px; text-align: right; font-family: var(--fonte-titulo), sans-serif; font-size: 18px; }
.resumo { flex: 1 1 320px; min-width: 0; background: var(--fundo-suave); border-radius: var(--raio-g); padding: 32px; display: flex; flex-direction: column; gap: 16px; }
.resumo p { margin: 0; color: var(--tinta-suave); }
.total { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
.total strong { font-family: var(--fonte-titulo), sans-serif; font-size: 28px; }
.vazio { display: flex; flex-direction: column; align-items: flex-start; gap: 16px; color: var(--tinta-suave); }
.botao { display: inline-flex; align-items: center; height: 52px; padding: 0 28px; border-radius: var(--raio-pilula); background: var(--tinta); color: #ffffff; font-weight: 600; text-decoration: none; }
```

- [ ] **Step 9: Conferir de verdade**

Com API e site rodando, pegar um id de produto e gravar pelo site:

```bash
ID=$(curl -s -H "X-Tenant: cahu" "http://localhost:3000/v1/produtos?limite=1" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).dados[0].id))")
curl -s -i -X PUT http://localhost:3010/api/carrinho/itens -H "Origin: http://localhost:3010" -H "Content-Type: application/json" -d "{\"produtoId\":\"$ID\",\"quantidade\":2}" | head -20
curl -s -o /dev/null -w "%{http_code}\n" -X PUT http://localhost:3010/api/carrinho/itens -H "Origin: https://outro.com" -H "Content-Type: application/json" -d "{\"produtoId\":\"$ID\",\"quantidade\":2}"
```

Expected: a primeira resposta é `200`, tem `Set-Cookie: fc_dispositivo=...; HttpOnly` e um JSON com o item e `quantidade: 2`; a segunda imprime `403`.

- [ ] **Step 10: Build e commit**

Run: `npm test --workspace apps/site && npm run build --workspace apps/site`. Expected: PASS e `Compiled successfully`.

```bash
git add apps/site/src
git commit -m "Site: carrinho do visitante (cookie de dispositivo, rotas /api, botão adicionar e contador)" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 6: Página inicial: cartão de produto, selos, vitrines e banners

**Files:**
- Create: `apps/site/src/lib/catalogo/selos.ts`, `apps/site/src/lib/catalogo/home.ts`
- Test: `apps/site/src/lib/catalogo/catalogo.test.ts`
- Create: `apps/site/src/componentes/CartaoProduto.tsx`, `CartaoProduto.module.css`, `Vitrine.tsx`, `Vitrine.module.css`, `Banners.tsx`, `Banners.module.css`
- Modify: `apps/site/src/app/page.tsx` (substituir inteiro)

**Interfaces:**
- Consumes: tipos `Produto`, `Home`, `Patrocinador`, `Banner`; `formatarPreco`, `precoPorUnidade`, `percentualDesconto`, `rotuloEmbalagem`, `formatarValidade`, `caminhoProduto`, `caminhoCategoria`; `<BotaoAdicionar>`.
- Produces:
  - `type Selo = { tipo: 'oferta' | 'estoque' | 'validade' | 'quantidade'; texto: string }`
  - `selosDoProduto(p: Produto, limiteEstoqueBaixo: number): Selo[]`
  - `type SecaoHome = { tipo: 'produtos'; chave: string; titulo: string; produtos: Produto[]; verTodos: string | null } | { tipo: 'patrocinador'; chave: string; patrocinador: Patrocinador }`
  - `montarSecoesHome(home: Home): SecaoHome[]`
  - `<CartaoProduto produto limiteEstoqueBaixo />`, `<Vitrine titulo produtos verTodos limiteEstoqueBaixo />`, `<VitrinePatrocinada patrocinador limiteEstoqueBaixo />`, `<Banners banners />`

- [ ] **Step 1: Escrever o teste que falha**

`apps/site/src/lib/catalogo/catalogo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Home, Patrocinador, Produto } from '@/lib/api/tipos';
import { montarSecoesHome } from './home';
import { selosDoProduto } from './selos';

export const produto = (extra: Partial<Produto> = {}): Produto => ({
  id: '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295', sku: null, ean: null, nome: 'Detergente', descricao: null,
  unidadeVenda: 'CX', qtdPorEmbalagem: 24, qtdMinima: 1, descontoQtdMinima: null, descontoQtdPreco: null,
  dataValidade: null, marca: null, marcaId: null, categoria: 'Limpeza', categoriaId: 'c1', estoque: 100,
  precoTabela: 52.8, precoPromocional: null, preco: 52.8, imagens: [], ...extra,
});

describe('selosDoProduto', () => {
  it('produto comum não tem selo', () => {
    expect(selosDoProduto(produto(), 5)).toEqual([]);
  });
  it('oferta mostra o percentual', () => {
    expect(selosDoProduto(produto({ precoTabela: 79.9, precoPromocional: 59.9, preco: 59.9 }), 0))
      .toEqual([{ tipo: 'oferta', texto: '-25%' }]);
  });
  it('oferta sem preço de tabela mostra só "Oferta"', () => {
    expect(selosDoProduto(produto({ precoTabela: null, precoPromocional: 59.9, preco: 59.9 }), 0))
      .toEqual([{ tipo: 'oferta', texto: 'Oferta' }]);
  });
  it('estoque baixo só com limite ligado e estoque dentro dele', () => {
    expect(selosDoProduto(produto({ estoque: 3 }), 5)).toEqual([{ tipo: 'estoque', texto: '3 em estoque' }]);
    expect(selosDoProduto(produto({ estoque: 3 }), 0)).toEqual([]);
    expect(selosDoProduto(produto({ estoque: 6 }), 5)).toEqual([]);
  });
  it('validade e desconto por quantidade', () => {
    expect(selosDoProduto(produto({ dataValidade: '2026-12-05', descontoQtdMinima: 4, descontoQtdPreco: 49.9 }), 0)).toEqual([
      { tipo: 'validade', texto: 'Val. 05/12' },
      { tipo: 'quantidade', texto: '4 ou mais: R$ 49,90' },
    ]);
  });
});

describe('montarSecoesHome', () => {
  const pat = (id: string): Patrocinador => ({ tipo: 'patrocinador', id, nome: `Pat ${id}`, logoUrl: null, bannerUrl: null, produtos: [produto()] });
  const base: Home = {
    banners: [], promocoes: [produto()], maisVendidos: [produto()], vencimentoProximo: [produto()],
    prateleiras: [{ tipo: 'categoria', categoriaId: 'c1', nome: 'Limpeza', produtos: [produto()] }, pat('meio')],
    patrocinadoresTopo: [pat('topo')], patrocinadoresOfertas: [pat('ofertas')],
  };

  it('segue a ordem do app', () => {
    expect(montarSecoesHome(base).map((s) => s.chave)).toEqual([
      'pat-topo', 'ofertas', 'pat-ofertas', 'mais-vendidos', 'vencimento', 'cat-c1', 'pat-meio',
    ]);
  });
  it('ofertas e categoria têm "ver todos"; as outras não', () => {
    const s = montarSecoesHome(base);
    const de = (chave: string) => s.find((x) => x.chave === chave) as Extract<(typeof s)[number], { tipo: 'produtos' }>;
    expect(de('ofertas').verTodos).toBe('/ofertas');
    expect(de('cat-c1').verTodos).toBe('/c/limpeza-c1');
    expect(de('mais-vendidos').verTodos).toBeNull();
  });
  it('pula seção sem produto', () => {
    const s = montarSecoesHome({ ...base, promocoes: [], vencimentoProximo: [], patrocinadoresTopo: [] });
    expect(s.map((x) => x.chave)).toEqual(['pat-ofertas', 'mais-vendidos', 'cat-c1', 'pat-meio']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./home` e `./selos` não existem).

- [ ] **Step 3: Implementar `selos.ts` e `home.ts`**

`apps/site/src/lib/catalogo/selos.ts`:

```ts
import type { Produto } from '@/lib/api/tipos';
import { formatarValidade } from '@/lib/formato/datas';
import { formatarPreco, percentualDesconto } from '@/lib/formato/preco';

export interface Selo { tipo: 'oferta' | 'estoque' | 'validade' | 'quantidade'; texto: string }

export function selosDoProduto(p: Produto, limiteEstoqueBaixo: number): Selo[] {
  const selos: Selo[] = [];
  if (p.precoPromocional != null) {
    const pct = percentualDesconto(p.precoTabela, p.preco);
    selos.push({ tipo: 'oferta', texto: pct != null ? `-${pct}%` : 'Oferta' });
  }
  if (limiteEstoqueBaixo > 0 && p.estoque > 0 && p.estoque <= limiteEstoqueBaixo) {
    selos.push({ tipo: 'estoque', texto: `${Math.floor(p.estoque)} em estoque` });
  }
  if (p.dataValidade) selos.push({ tipo: 'validade', texto: `Val. ${formatarValidade(p.dataValidade)}` });
  if (p.descontoQtdMinima != null && p.descontoQtdPreco != null) {
    selos.push({ tipo: 'quantidade', texto: `${p.descontoQtdMinima} ou mais: ${formatarPreco(p.descontoQtdPreco)}` });
  }
  return selos;
}
```

`apps/site/src/lib/catalogo/home.ts`:

```ts
import type { Home, Patrocinador, Produto } from '@/lib/api/tipos';
import { caminhoCategoria } from '@/lib/formato/caminhos';

export type SecaoHome =
  | { tipo: 'produtos'; chave: string; titulo: string; produtos: Produto[]; verTodos: string | null }
  | { tipo: 'patrocinador'; chave: string; patrocinador: Patrocinador };

const patrocinada = (p: Patrocinador): SecaoHome => ({ tipo: 'patrocinador', chave: `pat-${p.id}`, patrocinador: p });

/** Mesma ordem da Home do app (home_screen.dart): patrocinador do topo, Ofertas, patrocinador
 *  das ofertas, Mais vendidos, Vencimento Próximo e depois as prateleiras. Seção vazia some. */
export function montarSecoesHome(home: Home): SecaoHome[] {
  const secoes: SecaoHome[] = [
    ...home.patrocinadoresTopo.map(patrocinada),
    { tipo: 'produtos', chave: 'ofertas', titulo: 'Ofertas da semana', produtos: home.promocoes, verTodos: '/ofertas' },
    ...home.patrocinadoresOfertas.map(patrocinada),
    { tipo: 'produtos', chave: 'mais-vendidos', titulo: 'Mais pedidos', produtos: home.maisVendidos, verTodos: null },
    { tipo: 'produtos', chave: 'vencimento', titulo: 'Vencimento próximo', produtos: home.vencimentoProximo, verTodos: null },
    ...home.prateleiras.map((p): SecaoHome =>
      p.tipo === 'patrocinador'
        ? patrocinada(p)
        : { tipo: 'produtos', chave: `cat-${p.categoriaId}`, titulo: p.nome, produtos: p.produtos, verTodos: caminhoCategoria({ id: p.categoriaId, nome: p.nome }) }),
  ];
  return secoes.filter((s) => (s.tipo === 'produtos' ? s.produtos.length > 0 : s.patrocinador.produtos.length > 0));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS.

- [ ] **Step 5: Cartão de produto**

`apps/site/src/componentes/CartaoProduto.tsx`:

```tsx
import Link from 'next/link';
import type { Produto } from '@/lib/api/tipos';
import { selosDoProduto } from '@/lib/catalogo/selos';
import { caminhoProduto } from '@/lib/formato/caminhos';
import { rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import { BotaoAdicionar } from './BotaoAdicionar';
import estilos from './CartaoProduto.module.css';

export function CartaoProduto({ produto, limiteEstoqueBaixo }: { produto: Produto; limiteEstoqueBaixo: number }) {
  const href = caminhoProduto(produto);
  const foto = produto.imagens[0];
  const unidade = produto.preco != null ? precoPorUnidade(produto.preco, produto.qtdPorEmbalagem) : null;
  const selos = selosDoProduto(produto, limiteEstoqueBaixo);
  const emOferta = produto.precoPromocional != null && produto.precoTabela != null && produto.precoTabela > (produto.preco ?? 0);

  return (
    <article className={estilos.cartao} data-testid="cartao-produto">
      <Link href={href} className={estilos.foto} aria-label={produto.nome}>
        {foto
          ? <img src={foto.miniatura ?? foto.url} alt="" loading="lazy" decoding="async" />
          : <span className={estilos.semFoto}>Sem foto</span>}
        {selos.length > 0 && (
          <span className={estilos.selos}>
            {selos.map((s) => <span key={s.tipo} className={`${estilos.selo} ${estilos[s.tipo]}`}>{s.texto}</span>)}
          </span>
        )}
      </Link>
      <div className={estilos.texto}>
        {produto.categoria && <span className={estilos.suave}>{produto.categoria}</span>}
        <Link href={href} className={estilos.nome}>{produto.nome}</Link>
        <span className={estilos.suave}>{rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem)}</span>
      </div>
      <div className={estilos.rodape}>
        {produto.preco != null ? (
          <div>
            {emOferta && <s className={estilos.suave}>{formatarPreco(produto.precoTabela as number)}</s>}
            <strong className={estilos.preco}>{formatarPreco(produto.preco)}</strong>
            {unidade != null && <span className={estilos.suave}>{formatarPreco(unidade)} a unidade</span>}
          </div>
        ) : (
          <span className={estilos.suave}>Preço sob consulta</span>
        )}
        {produto.preco != null && produto.estoque > 0 && (
          <BotaoAdicionar produtoId={produto.id} qtdMinima={produto.qtdMinima} nome={produto.nome} />
        )}
      </div>
    </article>
  );
}
```

`apps/site/src/componentes/CartaoProduto.module.css`:

```css
.cartao { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.foto {
  position: relative; display: flex; align-items: center; justify-content: center;
  aspect-ratio: 4 / 3; background: var(--fundo-suave); border-radius: var(--raio-m); overflow: hidden; text-decoration: none;
}
.foto img { width: 100%; height: 100%; object-fit: contain; padding: 12px; }
.semFoto { font-size: 12px; color: var(--tinta-suave); }
.selos { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
.selo { padding: 4px 10px; border-radius: var(--raio-pilula); font-size: 12px; font-weight: 600; background: #ffffff; color: var(--tinta); }
.oferta { background: var(--destaque); color: var(--sobre-destaque); }
.estoque { color: var(--alerta); }
.validade { color: var(--perigo); }
.quantidade { color: var(--positivo); }
.texto { display: flex; flex-direction: column; gap: 4px; }
.suave { display: block; font-size: 13px; color: var(--tinta-suave); }
.nome { font-weight: 600; font-size: 16px; line-height: 1.35; text-decoration: none; }
.nome:hover { text-decoration: underline; }
.rodape { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
.preco { display: block; font-family: var(--fonte-titulo), sans-serif; font-weight: 800; font-size: 24px; letter-spacing: -0.02em; line-height: 1.2; }
```

- [ ] **Step 6: Vitrines e banners**

`apps/site/src/componentes/Vitrine.tsx`:

```tsx
import Link from 'next/link';
import type { Patrocinador, Produto } from '@/lib/api/tipos';
import { CartaoProduto } from './CartaoProduto';
import estilos from './Vitrine.module.css';

function Trilho({ produtos, limiteEstoqueBaixo }: { produtos: Produto[]; limiteEstoqueBaixo: number }) {
  return (
    <div className={estilos.trilho}>
      {produtos.map((p) => (
        <div key={p.id} className={estilos.vaga}>
          <CartaoProduto produto={p} limiteEstoqueBaixo={limiteEstoqueBaixo} />
        </div>
      ))}
    </div>
  );
}

export function Vitrine({ titulo, produtos, verTodos, limiteEstoqueBaixo }: {
  titulo: string; produtos: Produto[]; verTodos: string | null; limiteEstoqueBaixo: number;
}) {
  return (
    <section className={estilos.vitrine} aria-label={titulo}>
      <div className={estilos.topo}>
        <h2>{titulo}</h2>
        {verTodos && <Link href={verTodos}>Ver todos</Link>}
      </div>
      <Trilho produtos={produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} />
    </section>
  );
}

export function VitrinePatrocinada({ patrocinador, limiteEstoqueBaixo }: { patrocinador: Patrocinador; limiteEstoqueBaixo: number }) {
  return (
    <section className={estilos.vitrine} aria-label={`Produtos ${patrocinador.nome}`}>
      {patrocinador.bannerUrl && <img src={patrocinador.bannerUrl} alt="" loading="lazy" className={estilos.bannerPatrocinio} />}
      <div className={estilos.topo}>
        <div className={estilos.marca}>
          {patrocinador.logoUrl && <img src={patrocinador.logoUrl} alt="" loading="lazy" />}
          <h2>{patrocinador.nome}</h2>
        </div>
        <span className={estilos.patrocinado}>Patrocinado</span>
      </div>
      <Trilho produtos={patrocinador.produtos} limiteEstoqueBaixo={limiteEstoqueBaixo} />
    </section>
  );
}
```

`apps/site/src/componentes/Vitrine.module.css`:

```css
.vitrine { display: flex; flex-direction: column; gap: 24px; }
.topo { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; }
.topo h2 { font-size: 28px; }
.topo a { font-weight: 600; }
.trilho {
  display: flex; gap: 24px; overflow-x: auto; scroll-snap-type: x proximity;
  padding-bottom: 12px; scrollbar-width: thin;
}
.vaga { flex: 0 0 260px; scroll-snap-align: start; display: flex; }
.vaga > * { flex: 1; }
.marca { display: flex; align-items: center; gap: 12px; }
.marca img { height: 40px; width: auto; }
.patrocinado { font-size: 13px; color: var(--tinta-suave); }
.bannerPatrocinio { width: 100%; border-radius: var(--raio-m); }
@media (max-width: 640px) {
  .vaga { flex-basis: 200px; }
  .topo h2 { font-size: 22px; }
}
```

`apps/site/src/componentes/Banners.tsx`:

```tsx
import Link from 'next/link';
import type { Banner } from '@/lib/api/tipos';
import estilos from './Banners.module.css';

/** O banner só diz o tipo e o id do destino; o slug certo sai do redirecionamento da própria página. */
function destino(b: Banner): string | null {
  if (!b.destinoId) return null;
  if (b.destinoTipo === 'produto') return `/p/produto-${b.destinoId}`;
  if (b.destinoTipo === 'categoria') return `/c/categoria-${b.destinoId}`;
  return null;
}

export function Banners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <div className={`conteudo ${estilos.banners}`} aria-label="Destaques">
      {banners.map((b, i) => {
        const imagem = <img src={b.imagemUrl} alt={b.titulo ?? ''} loading={i === 0 ? 'eager' : 'lazy'} />;
        const href = destino(b);
        return href
          ? <Link key={b.id} href={href} className={estilos.banner}>{imagem}</Link>
          : <div key={b.id} className={estilos.banner}>{imagem}</div>;
      })}
    </div>
  );
}
```

`apps/site/src/componentes/Banners.module.css`:

```css
.banners { display: flex; gap: 16px; overflow-x: auto; scroll-snap-type: x mandatory; padding-block: 32px 0; scrollbar-width: none; }
.banner { flex: 0 0 100%; scroll-snap-align: center; border-radius: var(--raio-g); overflow: hidden; background: var(--fundo-suave); }
.banner img { width: 100%; aspect-ratio: 3.5 / 1; object-fit: cover; }
```

- [ ] **Step 7: Página inicial**

Substituir `apps/site/src/app/page.tsx` inteiro por:

```tsx
import { Banners } from '@/componentes/Banners';
import { Vitrine, VitrinePatrocinada } from '@/componentes/Vitrine';
import { buscarConfig, buscarHome } from '@/lib/api/catalogo';
import { montarSecoesHome } from '@/lib/catalogo/home';

export const revalidate = 60;

export default async function PaginaInicial() {
  const [home, config] = await Promise.all([buscarHome(), buscarConfig()]);
  const secoes = montarSecoesHome(home);
  return (
    <>
      <Banners banners={home.banners} />
      <div className="conteudo" style={{ display: 'flex', flexDirection: 'column', gap: 72, paddingBlock: 56 }}>
        {secoes.length === 0 && <p>Nenhum produto disponível no momento.</p>}
        {secoes.map((s) =>
          s.tipo === 'patrocinador'
            ? <VitrinePatrocinada key={s.chave} patrocinador={s.patrocinador} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
            : <Vitrine key={s.chave} titulo={s.titulo} produtos={s.produtos} verTodos={s.verTodos} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />,
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 8: Conferir no navegador**

Com API e site rodando, abrir `http://localhost:3010`.
Expected: banners (se houver), "Ofertas da semana", "Mais pedidos" e uma vitrine por categoria, cada cartão com foto, nome, embalagem, preço da caixa em destaque e preço da unidade embaixo. Clicar no "+" de um cartão: o botão vira `− 1 +` e o contador aparece no botão Carrinho.

- [ ] **Step 9: Build e commit**

Run: `npm test --workspace apps/site && npm run build --workspace apps/site`. Expected: PASS e `Compiled successfully`.

```bash
git add apps/site/src
git commit -m "Site: página inicial com banners, vitrines, cartão de produto e selos" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 7: Listagens: categoria, busca e ofertas

**Files:**
- Create: `apps/site/src/lib/catalogo/filtros.ts`
- Test: `apps/site/src/lib/catalogo/filtros.test.ts`
- Create: `apps/site/src/componentes/ListaProdutos.tsx`, `ListaProdutos.module.css`
- Create: `apps/site/src/app/c/[slug]/page.tsx`, `apps/site/src/app/busca/page.tsx`, `apps/site/src/app/ofertas/page.tsx`

**Interfaces:**
- Consumes: `buscarProdutos`, `buscarMarcas`, `buscarCategorias`, `buscarConfig`, `idDoSegmento`, `caminhoCategoria`, `UUID_INTEIRO`, `<CartaoProduto>`, tipos `PaginaProdutos`, `Marca`, `Categoria`.
- Produces:
  - `type Ordem = 'nome' | 'preco_asc' | 'preco_desc'`
  - `interface Filtros { pagina: number; ordem: Ordem; marca: string | null; sub: string | null }`
  - `lerFiltros(sp: Record<string, string | string[] | undefined>): Filtros`
  - `hrefCom(base: string, atual: Filtros, mudanca: Partial<Filtros>, fixos?: Record<string, string>): string`
  - `<ListaProdutos titulo base fixos filtros pagina marcas subcategorias limiteEstoqueBaixo vazio />`

- [ ] **Step 1: Escrever o teste que falha**

`apps/site/src/lib/catalogo/filtros.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hrefCom, lerFiltros, type Filtros } from './filtros';

const M = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const PADRAO: Filtros = { pagina: 1, ordem: 'nome', marca: null, sub: null };

describe('lerFiltros', () => {
  it('sem parâmetros devolve o padrão', () => {
    expect(lerFiltros({})).toEqual(PADRAO);
  });
  it('lê valores válidos', () => {
    expect(lerFiltros({ pagina: '3', ordem: 'preco_asc', marca: M, sub: S })).toEqual({ pagina: 3, ordem: 'preco_asc', marca: M, sub: S });
  });
  it('descarta valores inválidos (não chegam à API)', () => {
    expect(lerFiltros({ pagina: '-2', ordem: 'drop', marca: 'x', sub: ['y', S] })).toEqual(PADRAO);
    expect(lerFiltros({ pagina: 'abc' }).pagina).toBe(1);
    expect(lerFiltros({ pagina: '9999' }).pagina).toBe(500);
  });
});

describe('hrefCom', () => {
  it('omite o que é padrão', () => {
    expect(hrefCom('/c/x', PADRAO, {})).toBe('/c/x');
  });
  it('mudar filtro volta para a página 1', () => {
    expect(hrefCom('/c/x', { ...PADRAO, pagina: 4 }, { ordem: 'preco_desc' })).toBe('/c/x?ordem=preco_desc');
  });
  it('mudar só a página mantém os filtros', () => {
    expect(hrefCom('/c/x', { ...PADRAO, marca: M }, { pagina: 2 })).toBe(`/c/x?marca=${M}&pagina=2`);
  });
  it('parâmetros fixos (busca) vêm primeiro', () => {
    expect(hrefCom('/busca', PADRAO, { pagina: 2 }, { q: 'café torrado' })).toBe('/busca?q=caf%C3%A9+torrado&pagina=2');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./filtros` não existe).

- [ ] **Step 3: Implementar `filtros.ts`**

`apps/site/src/lib/catalogo/filtros.ts`:

```ts
import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export const ORDENS = ['nome', 'preco_asc', 'preco_desc'] as const;
export type Ordem = (typeof ORDENS)[number];
export const ROTULO_ORDEM: Record<Ordem, string> = { nome: 'Nome', preco_asc: 'Menor preço', preco_desc: 'Maior preço' };

export interface Filtros { pagina: number; ordem: Ordem; marca: string | null; sub: string | null }
export type ParametrosUrl = Record<string, string | string[] | undefined>;

const PAGINA_MAXIMA = 500;
const um = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? undefined : v);
const uuid = (v: string | undefined): string | null => (v && UUID_INTEIRO.test(v) ? v : null);

/** Tudo que vem da URL é validado aqui; valor inválido vira o padrão e nunca chega à API. */
export function lerFiltros(sp: ParametrosUrl): Filtros {
  const n = Number(um(sp.pagina));
  const pagina = Number.isInteger(n) && n >= 1 ? Math.min(n, PAGINA_MAXIMA) : 1;
  const ordemBruta = um(sp.ordem);
  const ordem = (ORDENS as readonly string[]).includes(ordemBruta ?? '') ? (ordemBruta as Ordem) : 'nome';
  return { pagina, ordem, marca: uuid(um(sp.marca)), sub: uuid(um(sp.sub)) };
}

/** Monta o link de um filtro ou página. Trocar qualquer filtro volta para a página 1. */
export function hrefCom(base: string, atual: Filtros, mudanca: Partial<Filtros>, fixos: Record<string, string> = {}): string {
  const mudouFiltro = Object.keys(mudanca).some((k) => k !== 'pagina');
  const f: Filtros = { ...atual, ...mudanca, pagina: mudanca.pagina ?? (mudouFiltro ? 1 : atual.pagina) };
  const q = new URLSearchParams(fixos);
  if (f.sub) q.set('sub', f.sub);
  if (f.marca) q.set('marca', f.marca);
  if (f.ordem !== 'nome') q.set('ordem', f.ordem);
  if (f.pagina > 1) q.set('pagina', String(f.pagina));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS.

- [ ] **Step 5: Componente da listagem**

`apps/site/src/componentes/ListaProdutos.tsx`:

```tsx
import Link from 'next/link';
import type { Categoria, Marca, PaginaProdutos } from '@/lib/api/tipos';
import { hrefCom, ORDENS, ROTULO_ORDEM, type Filtros } from '@/lib/catalogo/filtros';
import { CartaoProduto } from './CartaoProduto';
import estilos from './ListaProdutos.module.css';

interface Props {
  titulo: string;
  base: string;
  fixos?: Record<string, string>;
  filtros: Filtros;
  pagina: PaginaProdutos;
  marcas: Marca[];
  subcategorias: Categoria[];
  limiteEstoqueBaixo: number;
  vazio: string;
}

export function ListaProdutos({ titulo, base, fixos = {}, filtros, pagina, marcas, subcategorias, limiteEstoqueBaixo, vazio }: Props) {
  const link = (m: Partial<Filtros>) => hrefCom(base, filtros, m, fixos);
  const chip = (ativo: boolean) => `${estilos.chip} ${ativo ? estilos.ativo : ''}`;
  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <h1>{titulo}</h1>

      <div className={estilos.filtros}>
        {subcategorias.length > 0 && (
          <nav aria-label="Subcategorias" className={estilos.grupo}>
            <Link href={link({ sub: null })} className={chip(!filtros.sub)} aria-current={!filtros.sub ? 'true' : undefined}>Tudo</Link>
            {subcategorias.map((s) => (
              <Link key={s.id} href={link({ sub: s.id })} className={chip(filtros.sub === s.id)} aria-current={filtros.sub === s.id ? 'true' : undefined}>{s.nome}</Link>
            ))}
          </nav>
        )}
        {marcas.length > 1 && (
          <details className={estilos.marcas} open={filtros.marca != null}>
            <summary>Marcas</summary>
            <nav aria-label="Marcas" className={estilos.grupo}>
              <Link href={link({ marca: null })} className={chip(!filtros.marca)}>Todas</Link>
              {marcas.map((m) => (
                <Link key={m.id} href={link({ marca: m.id })} className={chip(filtros.marca === m.id)} aria-current={filtros.marca === m.id ? 'true' : undefined}>{m.nome}</Link>
              ))}
            </nav>
          </details>
        )}
        <nav aria-label="Ordenar por" className={estilos.grupo}>
          <span className={estilos.rotulo}>Ordenar por</span>
          {ORDENS.map((o) => (
            <Link key={o} href={link({ ordem: o })} className={chip(filtros.ordem === o)} aria-current={filtros.ordem === o ? 'true' : undefined}>{ROTULO_ORDEM[o]}</Link>
          ))}
        </nav>
      </div>

      {pagina.dados.length === 0 ? (
        <p className={estilos.vazio}>{vazio}</p>
      ) : (
        <div className={estilos.grade}>
          {pagina.dados.map((p) => <CartaoProduto key={p.id} produto={p} limiteEstoqueBaixo={limiteEstoqueBaixo} />)}
        </div>
      )}

      {(filtros.pagina > 1 || pagina.temMais) && (
        <nav aria-label="Páginas" className={estilos.paginas}>
          {filtros.pagina > 1
            ? <Link href={link({ pagina: filtros.pagina - 1 })} className={estilos.botao}>Anterior</Link>
            : <span />}
          <span>Página {filtros.pagina}</span>
          {pagina.temMais
            ? <Link href={link({ pagina: filtros.pagina + 1 })} className={estilos.botao}>Próxima</Link>
            : <span />}
        </nav>
      )}
    </div>
  );
}
```

`apps/site/src/componentes/ListaProdutos.module.css`:

```css
.pagina { padding-block: 48px; display: flex; flex-direction: column; gap: 32px; }
.pagina h1 { font-size: 40px; }
.filtros { display: flex; flex-direction: column; gap: 16px; }
.grupo { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.rotulo { font-size: 13px; color: var(--tinta-suave); margin-right: 4px; }
.chip {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px;
  border: 1px solid var(--linha-forte); border-radius: var(--raio-pilula); text-decoration: none; font-size: 14px; font-weight: 500;
}
.chip:hover { border-color: var(--tinta); }
.ativo { background: var(--tinta); border-color: var(--tinta); color: #ffffff; }
.marcas summary { cursor: pointer; font-weight: 600; min-height: 44px; display: flex; align-items: center; }
.grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 40px 24px; }
.vazio { color: var(--tinta-suave); font-size: 17px; }
.paginas { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: var(--tinta-suave); }
.botao {
  display: inline-flex; align-items: center; height: 48px; padding: 0 24px; border-radius: var(--raio-pilula);
  background: var(--tinta); color: #ffffff; font-weight: 600; text-decoration: none;
}
@media (max-width: 640px) {
  .pagina h1 { font-size: 30px; }
  .grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px 12px; }
}
```

- [ ] **Step 6: Página de categoria**

`apps/site/src/app/c/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarCategorias, buscarConfig, buscarMarcas, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';
import { caminhoCategoria, idDoSegmento } from '@/lib/formato/caminhos';

interface Props { params: Promise<{ slug: string }>; searchParams: Promise<ParametrosUrl> }

async function categoriaDe(slug: string) {
  const id = idDoSegmento(slug);
  if (!id) return null;
  const categorias = await buscarCategorias();
  const categoria = categorias.find((c) => c.id === id);
  return categoria ? { categoria, categorias } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const achada = await categoriaDe((await params).slug);
  return achada ? { title: achada.categoria.nome, alternates: { canonical: caminhoCategoria(achada.categoria) } } : {};
}

export default async function PaginaCategoria({ params, searchParams }: Props) {
  const { slug } = await params;
  const achada = await categoriaDe(slug);
  if (!achada) notFound();
  const { categoria, categorias } = achada;

  const canonico = caminhoCategoria(categoria);
  if (`/c/${slug}` !== canonico) permanentRedirect(canonico);

  const filtros = lerFiltros(await searchParams);
  const subcategorias = categorias.filter((c) => c.paiId === categoria.id);
  // Subcategoria só vale se for mesmo filha desta categoria.
  const alvo = filtros.sub && subcategorias.some((s) => s.id === filtros.sub) ? filtros.sub : categoria.id;

  const [pagina, marcas, config] = await Promise.all([
    buscarProdutos({ categoria: alvo, marca: filtros.marca ?? undefined, pagina: filtros.pagina, ordem: filtros.ordem }),
    buscarMarcas(categoria.id),
    buscarConfig(),
  ]);

  return (
    <ListaProdutos titulo={categoria.nome} base={canonico} filtros={filtros} pagina={pagina} marcas={marcas}
      subcategorias={subcategorias} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio="Nenhum produto disponível nesta categoria com esses filtros." />
  );
}
```

- [ ] **Step 7: Páginas de busca e de ofertas**

`apps/site/src/app/busca/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';

export const metadata: Metadata = { title: 'Busca', robots: { index: false, follow: true } };

export default async function PaginaBusca({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const filtros = lerFiltros(sp);
  const config = await buscarConfig();
  const pagina = q.length >= 2
    ? await buscarProdutos({ busca: q, pagina: filtros.pagina, ordem: filtros.ordem })
    : { dados: [], pagina: 1, temMais: false };

  return (
    <ListaProdutos titulo={q ? `Resultados para "${q}"` : 'Busca'} base="/busca" fixos={q ? { q } : {}}
      filtros={filtros} pagina={pagina} marcas={[]} subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo}
      vazio={q.length >= 2 ? 'Nenhum produto encontrado. Tente outra palavra.' : 'Digite pelo menos 2 letras para buscar.'} />
  );
}
```

`apps/site/src/app/ofertas/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { ListaProdutos } from '@/componentes/ListaProdutos';
import { buscarConfig, buscarProdutos } from '@/lib/api/catalogo';
import { lerFiltros, type ParametrosUrl } from '@/lib/catalogo/filtros';

export const metadata: Metadata = { title: 'Ofertas da semana' };

export default async function PaginaOfertas({ searchParams }: { searchParams: Promise<ParametrosUrl> }) {
  const filtros = lerFiltros(await searchParams);
  const [pagina, config] = await Promise.all([
    buscarProdutos({ promocao: true, pagina: filtros.pagina, ordem: filtros.ordem }),
    buscarConfig(),
  ]);
  return (
    <ListaProdutos titulo="Ofertas da semana" base="/ofertas" filtros={filtros} pagina={pagina} marcas={[]}
      subcategorias={[]} limiteEstoqueBaixo={config.limiteEstoqueBaixo} vazio="Nenhuma oferta no momento." />
  );
}
```

- [ ] **Step 8: Conferir no navegador**

Com API e site rodando: clicar numa categoria do cabeçalho; clicar em "Menor preço" (a URL ganha `?ordem=preco_asc` e a ordem muda); buscar uma palavra que exista no catálogo; abrir `/ofertas`; abrir `/c/qualquer-coisa-<id de uma categoria real>` e ver o redirecionamento para o endereço certo; abrir `/c/nao-existe` e ver o 404.
Expected: tudo acima funciona; categoria com mais de 24 produtos mostra "Próxima".

- [ ] **Step 9: Build e commit**

Run: `npm test --workspace apps/site && npm run build --workspace apps/site`. Expected: PASS e `Compiled successfully`.

```bash
git add apps/site/src
git commit -m "Site: listagens de categoria, busca e ofertas com filtros, ordenação e paginação" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 8: Página do produto

**Files:**
- Create: `apps/site/src/lib/catalogo/preco-efetivo.ts`
- Test: `apps/site/src/lib/catalogo/preco-efetivo.test.ts`
- Create: `apps/site/src/componentes/Galeria.tsx`, `CompraProduto.tsx`
- Create: `apps/site/src/app/p/[slug]/page.tsx`, `apps/site/src/app/p/[slug]/produto.module.css`

**Interfaces:**
- Consumes: `buscarProduto`, `buscarRelacionados`, `buscarConfig`, `ErroApi`, `idDoSegmento`, `caminhoProduto`, `caminhoCategoria`, `selosDoProduto`, `rotuloEmbalagem`, `formatarPreco`, `precoPorUnidade`, `useCarrinho`, `<Vitrine>`.
- Produces: `precoEfetivo(p: { preco: number | null; precoTabela: number | null; descontoQtdMinima: number | null; descontoQtdPreco: number | null }, quantidade: number): number | null`

- [ ] **Step 1: Escrever o teste que falha**

`apps/site/src/lib/catalogo/preco-efetivo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { precoEfetivo } from './preco-efetivo';

const base = { preco: 79.9, precoTabela: 79.9, descontoQtdMinima: 4, descontoQtdPreco: 59.9 };

describe('precoEfetivo (mesma regra do carrinho da API)', () => {
  it('abaixo da quantidade mínima vale o preço normal', () => {
    expect(precoEfetivo(base, 3)).toBe(79.9);
  });
  it('a partir da quantidade mínima vale o preço com desconto', () => {
    expect(precoEfetivo(base, 4)).toBe(59.9);
    expect(precoEfetivo(base, 10)).toBe(59.9);
  });
  it('promoção mais barata que o desconto por quantidade continua valendo', () => {
    expect(precoEfetivo({ ...base, preco: 49.9 }, 4)).toBe(49.9);
  });
  it('sem desconto por quantidade cadastrado', () => {
    expect(precoEfetivo({ ...base, descontoQtdMinima: null, descontoQtdPreco: null }, 10)).toBe(79.9);
  });
  it('sem preço de tabela não aplica o desconto (a API também não)', () => {
    expect(precoEfetivo({ ...base, preco: null, precoTabela: null }, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/site`
Expected: FAIL (`./preco-efetivo` não existe).

- [ ] **Step 3: Implementar**

`apps/site/src/lib/catalogo/preco-efetivo.ts`:

```ts
interface Precos {
  preco: number | null;
  precoTabela: number | null;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
}

/** Espelha o cálculo de OrdersService.carrinho(): o menor entre o preço final e o desconto por
 *  quantidade, e o desconto só vale se o produto tem preço de tabela. A API continua sendo a
 *  fonte da verdade; isto só adianta o total na tela antes de gravar no carrinho. */
export function precoEfetivo(p: Precos, quantidade: number): number | null {
  if (p.preco == null) return null;
  const temDesconto = p.precoTabela != null && p.descontoQtdMinima != null && p.descontoQtdPreco != null
    && quantidade >= p.descontoQtdMinima;
  return temDesconto ? Math.min(p.preco, p.descontoQtdPreco as number) : p.preco;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/site`
Expected: PASS.

- [ ] **Step 5: Galeria e bloco de compra**

`apps/site/src/componentes/Galeria.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { Imagem } from '@/lib/api/tipos';
import estilos from '@/app/p/[slug]/produto.module.css';

export function Galeria({ imagens, nome }: { imagens: Imagem[]; nome: string }) {
  const [atual, setAtual] = useState(0);
  if (imagens.length === 0) return <div className={estilos.fotoGrande}><span>Sem foto</span></div>;
  return (
    <div className={estilos.galeria}>
      <div className={estilos.fotoGrande}><img src={imagens[atual].url} alt={nome} /></div>
      {imagens.length > 1 && (
        <div className={estilos.miniaturas}>
          {imagens.map((img, i) => (
            <button key={img.url} type="button" aria-label={`Ver foto ${i + 1}`} aria-pressed={i === atual}
              className={i === atual ? estilos.miniaturaAtiva : estilos.miniatura} onClick={() => setAtual(i)}>
              <img src={img.miniatura ?? img.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

`apps/site/src/componentes/CompraProduto.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { precoEfetivo } from '@/lib/catalogo/preco-efetivo';
import { formatarPreco } from '@/lib/formato/preco';
import { useCarrinho } from './CarrinhoProvider';
import estilos from '@/app/p/[slug]/produto.module.css';

interface Props {
  produtoId: string;
  qtdMinima: number;
  qtdPorEmbalagem: number;
  preco: number | null;
  precoTabela: number | null;
  descontoQtdMinima: number | null;
  descontoQtdPreco: number | null;
}

export function CompraProduto(p: Props) {
  const { quantidadeDe, definir, ocupado } = useCarrinho();
  const noCarrinho = quantidadeDe(p.produtoId);
  const minimo = Math.max(1, p.qtdMinima);
  const [qtd, setQtd] = useState(minimo);

  // Quando o carrinho carrega (ou muda), o seletor mostra o que já está lá.
  useEffect(() => { if (noCarrinho > 0) setQtd(noCarrinho); }, [noCarrinho]);

  const unitario = precoEfetivo(p, qtd);
  if (unitario == null) return null;

  return (
    <div className={estilos.compra}>
      <div className={estilos.compraLinha}>
        <div className={estilos.seletor}>
          <button type="button" aria-label="Diminuir quantidade" disabled={qtd <= minimo} onClick={() => setQtd(qtd - 1)}>−</button>
          <span aria-live="polite">{qtd}</span>
          <button type="button" aria-label="Aumentar quantidade" onClick={() => setQtd(qtd + 1)}>+</button>
        </div>
        <div className={estilos.totalCompra}>
          {p.qtdPorEmbalagem > 1 && <span>{qtd * p.qtdPorEmbalagem} unidades no total</span>}
          <strong>{formatarPreco(unitario * qtd)}</strong>
        </div>
      </div>
      {minimo > 1 && <p className={estilos.nota}>Quantidade mínima: {minimo}</p>}
      <button type="button" className={estilos.botaoComprar} disabled={ocupado || qtd === noCarrinho}
        onClick={() => definir(p.produtoId, qtd)}>
        {noCarrinho === 0 ? 'Adicionar ao carrinho' : qtd === noCarrinho ? 'No carrinho' : 'Atualizar carrinho'}
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Página e estilos**

`apps/site/src/app/p/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { CompraProduto } from '@/componentes/CompraProduto';
import { Galeria } from '@/componentes/Galeria';
import { Vitrine } from '@/componentes/Vitrine';
import { buscarConfig, buscarProduto, buscarRelacionados } from '@/lib/api/catalogo';
import { ErroApi } from '@/lib/api/cliente';
import type { Produto } from '@/lib/api/tipos';
import { selosDoProduto } from '@/lib/catalogo/selos';
import { caminhoCategoria, caminhoProduto, idDoSegmento } from '@/lib/formato/caminhos';
import { nomeEmbalagem, rotuloEmbalagem } from '@/lib/formato/embalagem';
import { formatarPreco, precoPorUnidade } from '@/lib/formato/preco';
import estilos from './produto.module.css';

export const revalidate = 60;
/** Nenhuma página gerada no build; cada produto é montado no primeiro acesso e fica em cache. */
export async function generateStaticParams() { return []; }

interface Props { params: Promise<{ slug: string }> }

async function produtoDe(slug: string): Promise<Produto | null> {
  const id = idDoSegmento(slug);
  if (!id) return null;
  try {
    return await buscarProduto(id);
  } catch (e) {
    if (e instanceof ErroApi && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const produto = await produtoDe((await params).slug);
  if (!produto) return {};
  return {
    title: produto.nome,
    description: `${produto.nome}, ${rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem).toLowerCase()}.`,
    alternates: { canonical: caminhoProduto(produto) },
  };
}

export default async function PaginaProduto({ params }: Props) {
  const { slug } = await params;
  const produto = await produtoDe(slug);
  if (!produto) notFound();

  const canonico = caminhoProduto(produto);
  if (`/p/${slug}` !== canonico) permanentRedirect(canonico);

  const [relacionados, config] = await Promise.all([buscarRelacionados(produto.id), buscarConfig()]);
  const unidade = produto.preco != null ? precoPorUnidade(produto.preco, produto.qtdPorEmbalagem) : null;
  const selos = selosDoProduto(produto, config.limiteEstoqueBaixo);
  const disponivel = produto.preco != null && produto.estoque > 0;
  const emOferta = produto.precoPromocional != null && produto.precoTabela != null && produto.precoTabela > (produto.preco ?? 0);

  return (
    <div className={`conteudo ${estilos.pagina}`}>
      <nav aria-label="Você está em" className={estilos.trilha}>
        <Link href="/">Início</Link>
        {produto.categoria && produto.categoriaId && (
          <><span aria-hidden="true">/</span><Link href={caminhoCategoria({ id: produto.categoriaId, nome: produto.categoria })}>{produto.categoria}</Link></>
        )}
        <span aria-hidden="true">/</span><span>{produto.nome}</span>
      </nav>

      <div className={estilos.principal}>
        <div className={estilos.colunaFoto}><Galeria imagens={produto.imagens} nome={produto.nome} /></div>

        <div className={estilos.colunaInfo}>
          <div className={estilos.cabeca}>
            {produto.marca && <span className={estilos.sobre}>{produto.marca}</span>}
            <h1>{produto.nome}</h1>
            <div className={estilos.meta}>
              {produto.sku && <span>Cód. {produto.sku}</span>}
              <span className={disponivel ? estilos.emEstoque : estilos.semEstoque}>
                {disponivel ? 'Em estoque' : 'Indisponível no momento'}
              </span>
            </div>
            {selos.length > 0 && (
              <div className={estilos.selos}>
                {selos.map((s) => <span key={s.tipo} className={`${estilos.selo} ${estilos[s.tipo]}`}>{s.texto}</span>)}
              </div>
            )}
          </div>

          {produto.preco != null ? (
            <div className={estilos.precos}>
              <div className={estilos.precoPrincipal}>
                <span>{rotuloEmbalagem(produto.unidadeVenda, produto.qtdPorEmbalagem)}</span>
                {emOferta && <s>{formatarPreco(produto.precoTabela as number)}</s>}
                <strong>{formatarPreco(produto.preco)}</strong>
              </div>
              {unidade != null && (
                <div className={estilos.precoSecundario}>
                  <span>Sai por unidade</span>
                  <strong>{formatarPreco(unidade)}</strong>
                </div>
              )}
            </div>
          ) : (
            <p className={estilos.nota}>Preço sob consulta. Fale com a distribuidora.</p>
          )}

          {disponivel && (
            <CompraProduto produtoId={produto.id} qtdMinima={produto.qtdMinima} qtdPorEmbalagem={produto.qtdPorEmbalagem}
              preco={produto.preco} precoTabela={produto.precoTabela}
              descontoQtdMinima={produto.descontoQtdMinima} descontoQtdPreco={produto.descontoQtdPreco} />
          )}

          <dl className={estilos.ficha}>
            <div><dt>Vendido por</dt><dd>{nomeEmbalagem(produto.unidadeVenda)}</dd></div>
            {produto.ean && <div><dt>Código de barras</dt><dd>{produto.ean}</dd></div>}
            {produto.categoria && <div><dt>Categoria</dt><dd>{produto.categoria}</dd></div>}
          </dl>
          {produto.descricao && <p className={estilos.descricao}>{produto.descricao}</p>}
        </div>
      </div>

      {relacionados.pecaTambem.length > 0 && (
        <Vitrine titulo="Quem leva este produto também pede" produtos={relacionados.pecaTambem} verTodos={null} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
      )}
      {relacionados.similares.length > 0 && (
        <Vitrine titulo="Produtos parecidos" produtos={relacionados.similares} verTodos={null} limiteEstoqueBaixo={config.limiteEstoqueBaixo} />
      )}
    </div>
  );
}
```

`apps/site/src/app/p/[slug]/produto.module.css`:

```css
.pagina { padding-block: 28px 0; display: flex; flex-direction: column; gap: 56px; }
.trilha { display: flex; flex-wrap: wrap; gap: 8px; font-size: 14px; color: var(--tinta-suave); }
.principal { display: flex; flex-wrap: wrap; gap: 40px 64px; align-items: flex-start; }
.colunaFoto { flex: 1 1 440px; min-width: 0; }
.colunaInfo { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; gap: 28px; }

.galeria { display: flex; flex-direction: column; gap: 16px; }
.fotoGrande {
  aspect-ratio: 1 / 1; background: var(--fundo-suave); border-radius: var(--raio-g); overflow: hidden;
  display: flex; align-items: center; justify-content: center; color: var(--tinta-suave); font-size: 13px;
}
.fotoGrande img { width: 100%; height: 100%; object-fit: contain; padding: 24px; }
.miniaturas { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.miniatura, .miniaturaAtiva {
  aspect-ratio: 1 / 1; padding: 6px; background: var(--fundo-suave); border: 2px solid transparent;
  border-radius: var(--raio-p); cursor: pointer; overflow: hidden;
}
.miniaturaAtiva { border-color: var(--tinta); }
.miniatura img, .miniaturaAtiva img { width: 100%; height: 100%; object-fit: contain; }

.cabeca { display: flex; flex-direction: column; gap: 10px; }
.cabeca h1 { font-size: 40px; }
.sobre { font-size: 13px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--tinta-suave); }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 14px; color: var(--tinta-suave); }
.emEstoque { color: var(--positivo); font-weight: 500; }
.semEstoque { color: var(--perigo); font-weight: 500; }
.selos { display: flex; flex-wrap: wrap; gap: 8px; }
.selo { padding: 4px 12px; border-radius: var(--raio-pilula); font-size: 13px; font-weight: 600; background: var(--fundo-suave); }
.oferta { background: var(--destaque); color: var(--sobre-destaque); }
.estoque { color: var(--alerta); }
.validade { color: var(--perigo); }
.quantidade { color: var(--positivo); }

.precos { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
.precoPrincipal, .precoSecundario { border-radius: var(--raio-m); padding: 20px; display: flex; flex-direction: column; gap: 4px; }
.precoPrincipal { border: 2px solid var(--tinta); }
.precoSecundario { border: 1px solid var(--linha); }
.precos span, .precos s { font-size: 13px; color: var(--tinta-suave); }
.precos strong { font-family: var(--fonte-titulo), sans-serif; font-weight: 800; font-size: 34px; letter-spacing: -0.02em; line-height: 1.1; }

.compra { display: flex; flex-direction: column; gap: 16px; }
.compraLinha { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.seletor { display: flex; align-items: center; gap: 4px; background: var(--fundo-suave); border-radius: var(--raio-pilula); padding: 4px; }
.seletor button { width: 48px; height: 48px; border: 0; border-radius: 50%; background: #ffffff; font-size: 20px; cursor: pointer; }
.seletor button:disabled { opacity: 0.4; cursor: default; }
.seletor span { min-width: 56px; text-align: center; font-weight: 600; font-size: 16px; }
.totalCompra { text-align: right; }
.totalCompra span { display: block; font-size: 13px; color: var(--tinta-suave); }
.totalCompra strong { font-family: var(--fonte-titulo), sans-serif; font-weight: 800; font-size: 24px; }
.botaoComprar {
  height: 60px; border: 0; border-radius: var(--raio-pilula); background: var(--destaque); color: var(--sobre-destaque);
  font-size: 17px; font-weight: 600; cursor: pointer;
}
.botaoComprar:disabled { opacity: 0.6; cursor: default; }
.nota { margin: 0; font-size: 14px; color: var(--tinta-suave); }

.ficha { margin: 0; border-top: 1px solid var(--linha); }
.ficha div { display: flex; justify-content: space-between; gap: 16px; padding-block: 14px; border-bottom: 1px solid var(--linha); }
.ficha dt { color: var(--tinta-suave); }
.ficha dd { margin: 0; font-weight: 500; text-align: right; }
.descricao { margin: 0; color: var(--tinta-suave); line-height: 1.6; white-space: pre-line; }

@media (max-width: 640px) {
  .cabeca h1 { font-size: 28px; }
  .precos strong { font-size: 28px; }
}
```

- [ ] **Step 7: Conferir no navegador**

Com API e site rodando, clicar num produto da página inicial.
Expected: foto grande, nome, "Em estoque", preço da embalagem e preço por unidade lado a lado, seletor de quantidade com o total mudando, botão "Adicionar ao carrinho" que vira "No carrinho" e atualiza o contador do cabeçalho, e as vitrines de relacionados. Abrir `/p/nome-errado-<id real>` redireciona para o endereço certo; `/p/nao-existe` dá 404. Num produto com desconto por quantidade cadastrado, passar da quantidade mínima baixa o total.

- [ ] **Step 8: Build e commit**

Run: `npm test --workspace apps/site && npm run build --workspace apps/site`. Expected: PASS e `Compiled successfully`.

```bash
git add apps/site/src
git commit -m "Site: página do produto com galeria, preço por caixa e unidade, compra e relacionados" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

### Task 9: Erros, cabeçalhos de segurança, aviso de página antiga e teste ponta a ponta

**Files:**
- Create: `apps/site/src/app/error.tsx`, `apps/site/src/app/not-found.tsx`, `apps/site/src/app/estados.module.css`
- Create: `apps/site/src/componentes/AvisoDesatualizado.tsx`
- Modify: `apps/site/next.config.ts` (substituir inteiro), `apps/site/src/app/page.tsx`, `apps/site/src/app/p/[slug]/page.tsx`
- Create: `apps/site/playwright.config.ts`, `apps/site/e2e/catalogo.spec.ts`, `apps/site/README.md`

**Interfaces:**
- Consumes: tudo das tarefas anteriores; `data-testid="cartao-produto"` e `data-testid="contador-carrinho"`.
- Produces: `<AvisoDesatualizado geradoEm={number} />`.

- [ ] **Step 1: Páginas de erro e de não encontrado**

`apps/site/src/app/estados.module.css`:

```css
.estado { padding-block: 96px; display: flex; flex-direction: column; align-items: flex-start; gap: 16px; }
.estado h1 { font-size: 40px; }
.estado p { margin: 0; color: var(--tinta-suave); font-size: 17px; max-width: 520px; }
.acoes { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
.botao {
  display: inline-flex; align-items: center; height: 52px; padding: 0 28px; border: 0; border-radius: var(--raio-pilula);
  background: var(--tinta); color: #ffffff; font-weight: 600; text-decoration: none; cursor: pointer;
}
```

`apps/site/src/app/not-found.tsx`:

```tsx
import Link from 'next/link';
import estilos from './estados.module.css';

export default function NaoEncontrado() {
  return (
    <div className={`conteudo ${estilos.estado}`}>
      <h1>Página não encontrada</h1>
      <p>O endereço pode ter mudado ou o produto saiu do catálogo. Use a busca no topo ou escolha uma categoria.</p>
      <div className={estilos.acoes}><Link href="/" className={estilos.botao}>Ir para o início</Link></div>
    </div>
  );
}
```

`apps/site/src/app/error.tsx`:

```tsx
'use client';

import estilos from './estados.module.css';

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className={`conteudo ${estilos.estado}`} role="alert">
      <h1>Não foi possível carregar</h1>
      <p>O servidor não respondeu agora. Seu carrinho continua salvo. Tente de novo em instantes.</p>
      <div className={estilos.acoes}>
        <button type="button" className={estilos.botao} onClick={reset}>Tentar novamente</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Aviso de página antiga**

Quando a API fica fora do ar, o Next continua servindo a última versão gerada da página inicial e da página do produto. Este aviso aparece quando essa versão tem mais de 10 minutos. Nas listagens com filtro (montadas a cada acesso) não há versão antiga para servir; ali vale a tela de erro do Step 1.

`apps/site/src/componentes/AvisoDesatualizado.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

const LIMITE_MS = 10 * 60 * 1000;

export function AvisoDesatualizado({ geradoEm }: { geradoEm: number }) {
  const [antiga, setAntiga] = useState(false);
  useEffect(() => { setAntiga(Date.now() - geradoEm > LIMITE_MS); }, [geradoEm]);
  if (!antiga) return null;
  const hora = new Date(geradoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return (
    <p role="status" className="conteudo" style={{ paddingBlock: 12, margin: '0 auto', fontSize: 13, color: 'var(--tinta-suave)' }}>
      Preços conferidos às {hora}. Atualize a página para ver os valores de agora.
    </p>
  );
}
```

Em `apps/site/src/app/page.tsx`: importar `import { AvisoDesatualizado } from '@/componentes/AvisoDesatualizado';` e acrescentar como primeiro filho do fragmento, antes de `<Banners ... />`:

```tsx
      <AvisoDesatualizado geradoEm={Date.now()} />
```

Em `apps/site/src/app/p/[slug]/page.tsx`: mesmo import e, como primeiro filho de `<div className={`conteudo ${estilos.pagina}`}>`:

```tsx
      <AvisoDesatualizado geradoEm={Date.now()} />
```

- [ ] **Step 3: Cabeçalhos de segurança**

Substituir `apps/site/next.config.ts` inteiro por:

```ts
import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// Fotos e banners vêm do /uploads da API (outro host), por isso img-src aberto a http/https.
// O Next injeta scripts e estilos em linha; sem nonce, 'unsafe-inline' é necessário.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default config;
```

- [ ] **Step 4: Teste ponta a ponta (escrever antes de rodar)**

Na raiz do repo:

```bash
npm install -D @playwright/test --workspace apps/site
npm exec --workspace apps/site -- playwright install chromium
```

`apps/site/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

// Precisa da API rodando em http://localhost:3000 com o banco de desenvolvimento (npm run api).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:3010' },
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3010',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
```

`apps/site/e2e/catalogo.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('início mostra produtos com preço e não é indexável', async ({ page }) => {
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  await expect(cartao).toBeVisible();
  await expect(cartao).toContainText('R$');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('do cartão à página do produto, e adicionar ao carrinho', async ({ page }) => {
  await page.goto('/');
  const cartao = page.getByTestId('cartao-produto').first();
  const nome = (await cartao.getByRole('link').last().innerText()).trim();
  await cartao.getByRole('link').last().click();

  await expect(page).toHaveURL(/\/p\/.+-[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(nome);

  await page.getByRole('button', { name: 'Adicionar ao carrinho' }).click();
  await expect(page.getByTestId('contador-carrinho')).toBeVisible();
  await expect(page.getByRole('button', { name: 'No carrinho' })).toBeVisible();

  await page.getByRole('link', { name: /Carrinho/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Seu carrinho' })).toBeVisible();
  await expect(page.getByText(nome).first()).toBeVisible();
});

test('categoria ordena por preço pela URL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Categorias' }).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/c\/.+-[0-9a-f-]{36}$/);
  await page.getByRole('link', { name: 'Menor preço' }).click();
  await expect(page).toHaveURL(/ordem=preco_asc/);
  await expect(page.getByTestId('cartao-produto').first()).toBeVisible();
});

test('busca sem resultado e endereço inexistente', async ({ page }) => {
  await page.goto('/busca?q=zzzzqqqqxxxx');
  await expect(page.getByText('Nenhum produto encontrado')).toBeVisible();
  const resp = await page.goto('/p/nao-existe');
  expect(resp?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
});

test('cabeçalhos de segurança presentes', async ({ request }) => {
  const r = await request.get('/');
  expect(r.headers()['x-frame-options']).toBe('DENY');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
});
```

- [ ] **Step 5: Rodar o ponta a ponta**

Com a API rodando (`npm run api`) e sem `npm run site` aberto (o Playwright sobe o build de produção):

Run: `npm run e2e --workspace apps/site`
Expected: `5 passed`. Se um teste falhar por seletor, corrigir o componente (não afrouxar o teste) e repetir.

- [ ] **Step 6: Medir o desempenho**

Com o site de produção local ainda no ar (`npm run start --workspace apps/site` depois do build), pegar o endereço de um produto na página inicial e rodar:

```bash
npx lighthouse "http://localhost:3010/p/<slug-de-um-produto-real>" --only-categories=performance --form-factor=mobile --quiet --chrome-flags="--headless" --output=json --output-path=./lighthouse-produto.json
node -e "const r=require('./lighthouse-produto.json');console.log('LCP ms:',Math.round(r.audits['largest-contentful-paint'].numericValue),'| nota:',Math.round(r.categories.performance.score*100))"
```

Expected: LCP abaixo de 2000 ms (meta da spec). Anotar o número no README (Step 7). Se passar de 2000 ms, o primeiro suspeito é o tamanho da foto principal: conferir o peso do arquivo em `/uploads` e relatar ao Tiago antes de mexer. Apagar `lighthouse-produto.json` depois (não vai para o git).

- [ ] **Step 7: README**

`apps/site/README.md`:

```markdown
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

Medição do Lighthouse móvel na página do produto, ao fim do Bloco 1: LCP de ____ ms (meta: abaixo de 2000 ms).
```

Preencher o `____` com o número medido no Step 6.

- [ ] **Step 8: Conferência final e commit**

Run: `npm test --workspace apps/site && npm test --workspace apps/api`
Expected: PASS nas duas suítes.

```bash
git add apps/site package.json package-lock.json
git commit -m "Site: páginas de erro, cabeçalhos de segurança, aviso de página antiga, E2E e README" -m "Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>"
```

---

## Pendências anotadas para o Bloco 2

- "Mais vendidos" e "relacionados" na API contam só pedidos com `origem = 'app_cliente'`. Quando o site passar a gravar pedidos com origem `site`, incluir essa origem nessas consultas.
- O cartão e a página do produto mostram a tabela padrão; com login, rebuscar os preços com a sessão do cliente.
- Trocar o texto provisório do carrinho ("finalize pelo app") pelo fluxo de checkout.
