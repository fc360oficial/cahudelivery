# Vitrines Patrocinadas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o admin (retaguarda) criar vitrines patrocinadas por indústria/fabricante — produtos escolhidos manualmente, com banner + logo + preço especial opcional — que aparecem na tela de Início do app, encaixadas logo depois de uma categoria escolhida (ou no topo).

**Architecture:** Segue os padrões já estabelecidos no `fluxo-commerce`: NestJS com SQL cru via `tenantCtx().pool` (sem ORM), DTOs `class-validator`, migração numerada em `infra/sql/tenant`, retaguarda React reaproveitando o padrão das telas "Promoções"/"Banners", app Flutter reaproveitando `produto_card.dart` e o padrão de vitrine horizontal do `home_screen.dart`.

**Tech Stack:** NestJS 10, PostgreSQL (driver `pg`, sem ORM), React 18 + Vite (sem framework de UI, CSS próprio), Flutter/Dart.

## Global Constraints

- Todo acesso a banco no backend usa `tenantCtx().pool` (nunca outro pool) — ver `apps/api/src/tenancy/tenant-context.ts`.
- SQL cru com parâmetros posicionais (`$1`, `$2`...), nunca concatenação de string com valor do usuário.
- Toda migração nova em `infra/sql/tenant/NNN_nome.sql` **deve** ser espelhada em `CAHU DELIVERY/11 - SQL/NNN_nome.sql` (pasta irmã de `fluxo-commerce`, fonte de verdade duplicada por convenção do projeto) e terminar com `insert into schema_migrations (versao) values ('NNN') on conflict do nothing;`.
- Este projeto **não usa testes automatizados de backend/mobile** para os CRUDs existentes (Promoções, Banners, Categorias não têm nenhum arquivo `.spec.ts`; o app Flutter só tem o teste padrão do scaffold) — a verificação estabelecida é manual: `curl` para a API, Chrome pra retaguarda, `flutter analyze` + rodar no dispositivo pro app. Este plano segue a mesma convenção em vez de introduzir um framework de teste novo só pra esta feature.
- Preço de produto sempre com `coalesce(<preço especial>, <preço promoção vigente>, <preço da tabela>)` — mesma precedência já usada em `SELECT_PRODUTO` (`catalog.service.ts`).
- Banco de dev local: `fluxo_t_cahu` (psql em `C:\Program Files\PostgreSQL\16\bin\psql.exe`, usuário `postgres`, senha `postgres`, host `localhost`).

---

### Task 1: Migração — tabelas `patrocinadores` e `patrocinador_produtos`

**Files:**
- Create: `infra/sql/tenant/007_patrocinadores.sql`
- Create: `../11 - SQL/007_patrocinadores.sql` (caminho relativo à raiz do repo: `../11 - SQL` = `CAHU DELIVERY/11 - SQL`, pasta irmã de `fluxo-commerce`)

**Interfaces:**
- Produz: tabelas `patrocinadores(id, nome, logo_url, banner_url, apos_categoria_id, ativo, criado_em, atualizado_em)` e `patrocinador_produtos(patrocinador_id, produto_id, preco_especial, ordem)`, consumidas pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migração**

Crie `infra/sql/tenant/007_patrocinadores.sql`:

```sql
-- Vitrines patrocinadas por indústria/fabricante (benchmark Praso, 23/07/2026).
-- Produtos escolhidos manualmente (não por marca) — uma indústria pode incluir
-- produtos de várias marcas dela. Aparece na Home logo depois de uma categoria
-- escolhida (apos_categoria_id null = aparece no topo, antes de tudo).
create table if not exists patrocinadores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  logo_url text,
  banner_url text,
  apos_categoria_id uuid references categorias(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists patrocinador_produtos (
  patrocinador_id uuid not null references patrocinadores(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  preco_especial numeric,
  ordem int not null default 0,
  primary key (patrocinador_id, produto_id)
);

insert into schema_migrations (versao) values ('007') on conflict do nothing;
```

Copie o mesmo conteúdo para `../11 - SQL/007_patrocinadores.sql` (mesmo nome de arquivo, mesma pasta espelhada).

- [ ] **Step 2: Aplicar no banco de dev e verificar**

Rode (PowerShell, a partir da raiz do `fluxo-commerce`):

```powershell
$env:PGPASSWORD='postgres'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -f infra\sql\tenant\007_patrocinadores.sql
```

Expected: duas linhas `CREATE TABLE` (ou nenhum erro se rodar de novo, por causa do `if not exists`) e `INSERT 0 1`.

- [ ] **Step 3: Confirmar as tabelas existem**

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -c "\d patrocinadores" -c "\d patrocinador_produtos"
```

Expected: a saída mostra as colunas exatamente como definidas acima (id uuid, nome text not null, etc.).

- [ ] **Step 4: Commit**

```bash
git add "infra/sql/tenant/007_patrocinadores.sql" "../11 - SQL/007_patrocinadores.sql"
git commit -m "feat(db): tabelas patrocinadores e patrocinador_produtos"
```

---

### Task 2: API — CRUD admin de patrocinadores

**Files:**
- Create: `apps/api/src/admin/admin-patrocinadores.controller.ts`
- Modify: `apps/api/src/admin/admin.module.ts`

**Interfaces:**
- Consome: `tenantCtx()` de `../tenancy/tenant-context` (retorna `{ tenant, pool }`), `AdminGuard` de `./admin.guard`.
- Produz: `AdminPatrocinadoresController`, registrado no `AdminModule`. Endpoints `GET/POST/PUT/DELETE /admin/patrocinadores(/:id)` consumidos pela Task 4 (retaguarda).

- [ ] **Step 1: Criar o controller**

Crie `apps/api/src/admin/admin-patrocinadores.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard } from './admin.guard';

class PatrocinadorProdutoDto {
  @IsUUID() produtoId!: string;
  @IsOptional() @IsNumber() @Min(0) precoEspecial?: number;
}

class PatrocinadorDto {
  @IsNotEmpty() nome!: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() bannerUrl?: string;
  @IsOptional() @IsUUID() aposCategoriaId?: string;
  @IsOptional() @IsBoolean() ativo?: boolean;
  @IsArray() @Type(() => PatrocinadorProdutoDto) produtos!: PatrocinadorProdutoDto[];
}

/** CRUD das vitrines patrocinadas (indústria/fabricante), gerenciado pela retaguarda. */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminPatrocinadoresController {
  @Get('patrocinadores')
  async listar() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select pat.id, pat.nome, pat.logo_url, pat.banner_url, pat.apos_categoria_id, pat.ativo,
              (select nome from categorias where id = pat.apos_categoria_id) as apos_categoria_nome,
              (select json_agg(json_build_object('produtoId', pp.produto_id, 'nome', pr.nome, 'sku', pr.sku,
                  'precoEspecial', pp.preco_especial) order by pp.ordem)
                 from patrocinador_produtos pp join produtos pr on pr.id = pp.produto_id
                where pp.patrocinador_id = pat.id) as produtos
         from patrocinadores pat order by pat.criado_em desc`,
    );
    return rows;
  }

  @Post('patrocinadores')
  async criar(@Body() dto: PatrocinadorDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows } = await client.query(
        `insert into patrocinadores (nome, logo_url, banner_url, apos_categoria_id, ativo)
         values ($1,$2,$3,$4,coalesce($5,true)) returning id`,
        [dto.nome, dto.logoUrl ?? null, dto.bannerUrl ?? null, dto.aposCategoriaId ?? null, dto.ativo],
      );
      for (const [i, p] of dto.produtos.entries()) {
        await client.query(
          `insert into patrocinador_produtos (patrocinador_id, produto_id, preco_especial, ordem)
           values ($1,$2,$3,$4)`,
          [rows[0].id, p.produtoId, p.precoEspecial ?? null, i],
        );
      }
      await client.query('commit');
      return { id: rows[0].id };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  @Put('patrocinadores/:id')
  async editar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PatrocinadorDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(
        `update patrocinadores set nome=$2, logo_url=$3, banner_url=$4, apos_categoria_id=$5,
                ativo=coalesce($6,ativo), atualizado_em=now()
          where id=$1 returning id`,
        [id, dto.nome, dto.logoUrl ?? null, dto.bannerUrl ?? null, dto.aposCategoriaId ?? null, dto.ativo],
      );
      if (!r.rowCount) throw new NotFoundException();
      await client.query(`delete from patrocinador_produtos where patrocinador_id = $1`, [id]);
      for (const [i, p] of dto.produtos.entries()) {
        await client.query(
          `insert into patrocinador_produtos (patrocinador_id, produto_id, preco_especial, ordem)
           values ($1,$2,$3,$4)`,
          [id, p.produtoId, p.precoEspecial ?? null, i],
        );
      }
      await client.query('commit');
      return { ok: true };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  @Delete('patrocinadores/:id')
  async remover(@Param('id', ParseUUIDPipe) id: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from patrocinador_produtos where patrocinador_id = $1`, [id]);
    await pool.query(`delete from patrocinadores where id = $1`, [id]);
    return { ok: true };
  }
}
```

- [ ] **Step 2: Registrar no módulo**

Edite `apps/api/src/admin/admin.module.ts` — adicione o import e inclua no array `controllers`:

```typescript
import { Module } from '@nestjs/common';
import { AdminAuthController } from './admin-auth.controller';
import { AdminCatalogoController } from './admin-catalogo.controller';
import { AdminConfigController } from './admin-config.controller';
import { AdminPatrocinadoresController } from './admin-patrocinadores.controller';
import { AdminUploadController } from './admin-upload.controller';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  controllers: [
    AdminAuthController,
    AdminController,
    AdminCatalogoController,
    AdminConfigController,
    AdminPatrocinadoresController,
    AdminUploadController,
  ],
  providers: [AdminService, AdminGuard],
})
export class AdminModule {}
```

- [ ] **Step 3: Rodar a API localmente**

Em `apps/api`:

```bash
npm run build && node dist/main.js
```

Expected: log de inicialização sem erro, API escutando na porta configurada (padrão 3000).

- [ ] **Step 4: Verificar manualmente com curl**

Pegue um token de admin (login de dev já existente, `admin@cahu.com.br` / `cahu@2026`):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/v1/admin/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"email":"admin@cahu.com.br","senha":"cahu@2026"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).accessToken" 2>/dev/null || true)
```

Se o comando acima não funcionar direto no seu shell, chame o login manualmente e copie o `accessToken` da resposta pra uma variável `$TOKEN`.

Crie um patrocinador de teste (troque `<PRODUTO_ID>` por um id real de `select id from produtos limit 1`):

```bash
curl -s -X POST http://localhost:3000/v1/admin/patrocinadores \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Teste Fabricante","produtos":[{"produtoId":"<PRODUTO_ID>"}]}'
```

Expected: `{"id":"<uuid>"}`.

```bash
curl -s http://localhost:3000/v1/admin/patrocinadores -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: array com um item `{"nome":"Teste Fabricante", "produtos":[{"produtoId":"<PRODUTO_ID>", ...}], "ativo": true, ...}`.

Remova o teste antes de seguir:

```bash
curl -s -X DELETE http://localhost:3000/v1/admin/patrocinadores/<uuid-retornado> -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"ok":true}`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/admin-patrocinadores.controller.ts apps/api/src/admin/admin.module.ts
git commit -m "feat(api): CRUD admin de patrocinadores"
```

---

### Task 3: API pública — incluir patrocinadores no `/v1/home`

**Files:**
- Modify: `apps/api/src/catalog/catalog.service.ts:67-110` (método `home`)

**Interfaces:**
- Consome: tabelas da Task 1, `SELECT_PRODUTO`/`tabelaPrecoDe` já existentes no mesmo arquivo.
- Produz: `prateleiras` no retorno de `home()` passa a ter itens com um campo `tipo: 'categoria' | 'patrocinador'`. Consumido pela Task 5 (app Flutter).

- [ ] **Step 1: Adicionar a query de patrocinadores e a lógica de mescla**

Em `apps/api/src/catalog/catalog.service.ts`, substitua o método `home` inteiro (linhas 67-110) por:

```typescript
  async home(clienteId?: string) {
    const { pool } = tenantCtx();
    const tabela = await this.tabelaPrecoDe(clienteId);
    const [banners, promocoes, maisVendidos, categoriasComProduto, patrocinadores] = await Promise.all([
      pool.query(
        `select id, titulo, imagem_url, destino_tipo, destino_id from banners
          where ativo and (inicio_em is null or now() >= inicio_em) and (fim_em is null or now() <= fim_em)
          order by ordem`,
      ),
      pool.query(`${SELECT_PRODUTO} and promo.preco_promocional is not null order by p.nome limit 10`, [tabela]),
      pool.query(
        `${SELECT_PRODUTO} and p.id in (
           select pi2.produto_id from pedido_itens pi2
             join pedidos pe on pe.id = pi2.pedido_id and pe.criado_em > now() - interval '30 days'
            group by pi2.produto_id order by sum(pi2.quantidade) desc limit 10)`,
        [tabela],
      ),
      // Categorias que têm produto ativo, na ordem cadastrada — vira "prateleira" na home.
      pool.query(
        `select c.id, c.nome from categorias c
          where c.ativo and exists (select 1 from produtos p where p.categoria_id = c.id and p.ativo)
          order by c.ordem, c.nome`,
      ),
      // Vitrines patrocinadas (indústria/fabricante) — produtos escolhidos manualmente,
      // com preço especial vencendo promoção que vence tabela (mesma precedência do SELECT_PRODUTO).
      pool.query(
        `select pat.id, pat.nome, pat.logo_url, pat.banner_url, pat.apos_categoria_id,
                (select json_agg(json_build_object(
                    'id', p.id, 'sku', p.sku, 'nome', p.nome, 'unidade_venda', p.unidade_venda,
                    'qtd_por_embalagem', p.qtd_por_embalagem, 'estoque', coalesce(e.quantidade,0),
                    'preco_tabela', pr.preco, 'preco_promocional', promo.preco_promocional,
                    'preco', coalesce(pp.preco_especial, promo.preco_promocional, pr.preco),
                    'imagens', (select json_agg(json_build_object('url', pi.url,'ordem', pi.ordem) order by pi.ordem)
                                  from produto_imagens pi where pi.produto_id = p.id)
                  ) order by pp.ordem)
                   from patrocinador_produtos pp
                   join produtos p on p.id = pp.produto_id and p.ativo
                   left join estoques e on e.produto_id = p.id
                   left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $1
                   left join lateral (
                     select ppo.preco_promocional from promocao_produtos ppo
                       join promocoes pm on pm.id = ppo.promocao_id
                      where ppo.produto_id = p.id and pm.ativo and now() between pm.inicio_em and pm.fim_em
                      order by ppo.preco_promocional asc limit 1
                   ) promo on true
                  where pp.patrocinador_id = pat.id
                ) as produtos
           from patrocinadores pat where pat.ativo order by pat.criado_em`,
        [tabela],
      ),
    ]);

    // Navegação por descoberta: uma prateleira horizontal por categoria (estilo "vitrine de loja"),
    // não só recomendação. Busca em paralelo, limitando itens por prateleira para a home carregar rápido.
    const prateleiras = await Promise.all(
      categoriasComProduto.rows.map(async (c) => {
        const { rows } = await pool.query(
          `${SELECT_PRODUTO} and p.categoria_id = $2 order by p.nome limit 10`,
          [tabela, c.id],
        );
        return { tipo: 'categoria' as const, categoriaId: c.id, nome: c.nome, produtos: rows };
      }),
    );

    // Mescla as vitrines patrocinadas ativas na posição escolhida na retaguarda:
    // logo depois da categoria referenciada (apos_categoria_id), ou no topo se nulo.
    const topo: unknown[] = [];
    const depoisDaCategoria = new Map<string, unknown[]>();
    for (const row of patrocinadores.rows) {
      if (!row.produtos?.length) continue;
      const item = {
        tipo: 'patrocinador' as const,
        id: row.id,
        nome: row.nome,
        logoUrl: row.logo_url,
        bannerUrl: row.banner_url,
        produtos: row.produtos,
      };
      if (row.apos_categoria_id) {
        const lista = depoisDaCategoria.get(row.apos_categoria_id) ?? [];
        lista.push(item);
        depoisDaCategoria.set(row.apos_categoria_id, lista);
      } else {
        topo.push(item);
      }
    }
    const feed: unknown[] = [...topo];
    for (const prat of prateleiras.filter((p) => p.produtos.length > 0)) {
      feed.push(prat);
      const extras = depoisDaCategoria.get(prat.categoriaId);
      if (extras) feed.push(...extras);
    }

    return {
      banners: banners.rows,
      promocoes: promocoes.rows,
      maisVendidos: maisVendidos.rows,
      prateleiras: feed,
    };
  }
```

- [ ] **Step 2: Verificar manualmente com curl**

Com a API rodando (`node dist/main.js` em `apps/api`, depois de `npm run build`) e usando o mesmo patrocinador de teste da Task 2 (recrie um se já removeu, desta vez sem remover):

```bash
curl -s -H "X-Tenant: cahu" http://localhost:3000/v1/home | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(d.prateleiras.map(p => ({tipo: p.tipo, nome: p.nome})));
"
```

Expected: um item com `{tipo: 'patrocinador', nome: 'Teste Fabricante'}` aparecendo na posição certa da lista (no topo se `aposCategoriaId` não foi enviado no Step 4 da Task 2, ou logo após a categoria indicada).

Remova o patrocinador de teste ao final:

```bash
curl -s -X DELETE http://localhost:3000/v1/admin/patrocinadores/<uuid> -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/catalog/catalog.service.ts
git commit -m "feat(api): inclui vitrines patrocinadas no /v1/home"
```

---

### Task 4: Retaguarda — tela "Patrocinadores"

**Files:**
- Create: `apps/admin/src/paginas/Patrocinadores.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Layout.tsx`

**Interfaces:**
- Consome: `api()` e `upload()` de `../api` (`apps/admin/src/api.ts`), endpoints da Task 2, `GET /admin/categorias` (já existe, usado por `Categorias.tsx`), `GET /admin/produtos-busca` (já existe, usado por `Promocoes.tsx`).

- [ ] **Step 1: Criar a tela**

Crie `apps/admin/src/paginas/Patrocinadores.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda, upload } from '../api';

interface ProdutoPatro { produtoId: string; nome: string; sku?: string; precoEspecial?: number }
interface Patrocinador {
  id: string; nome: string; logo_url?: string; banner_url?: string;
  apos_categoria_id?: string; apos_categoria_nome?: string; ativo: boolean;
  produtos: ProdutoPatro[] | null;
}
interface Categoria { id: string; nome: string; pai_id?: string }
interface ProdutoBusca { id: string; sku: string; nome: string; preco?: string }

const VAZIO = { nome: '', logoUrl: '', bannerUrl: '', aposCategoriaId: '' };

export function Patrocinadores() {
  const [dados, setDados] = useState<Patrocinador[] | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [form, setForm] = useState(VAZIO);
  const [itens, setItens] = useState<ProdutoPatro[]>([]);
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState<ProdutoBusca[]>([]);
  const [subindoLogo, setSubindoLogo] = useState(false);
  const [subindoBanner, setSubindoBanner] = useState(false);

  const carregar = useCallback(() => {
    api<Patrocinador[]>('/admin/patrocinadores').then(setDados).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    api<Categoria[]>('/admin/categorias').then(setCategorias).catch(() => {});
  }, []);

  useEffect(() => {
    if (busca.length < 2) return setSugestoes([]);
    const t = setTimeout(() => {
      api<ProdutoBusca[]>(`/admin/produtos-busca?q=${encodeURIComponent(busca)}`).then(setSugestoes).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  function abrirNovo() {
    setEditando(null); setForm(VAZIO); setItens([]); setAberto(true);
  }

  function abrirEdicao(p: Patrocinador) {
    setEditando(p.id);
    setForm({ nome: p.nome, logoUrl: p.logo_url ?? '', bannerUrl: p.banner_url ?? '', aposCategoriaId: p.apos_categoria_id ?? '' });
    setItens(p.produtos ?? []);
    setAberto(true);
  }

  async function escolherArquivo(campo: 'logoUrl' | 'bannerUrl', setSubindo: (v: boolean) => void, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setSubindo(true);
    try {
      const url = await upload(arquivo);
      setForm((f) => ({ ...f, [campo]: url }));
      setErro(null);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSubindo(false);
      e.target.value = '';
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!itens.length) return setErro('Adicione ao menos um produto ao patrocinador');
    try {
      const body = JSON.stringify({
        nome: form.nome,
        logoUrl: form.logoUrl || undefined,
        bannerUrl: form.bannerUrl || undefined,
        aposCategoriaId: form.aposCategoriaId || undefined,
        produtos: itens.map((i) => ({
          produtoId: i.produtoId,
          precoEspecial: i.precoEspecial != null && `${i.precoEspecial}` !== '' ? Number(i.precoEspecial) : undefined,
        })),
      });
      await (editando ? api(`/admin/patrocinadores/${editando}`, { method: 'PUT', body }) : api('/admin/patrocinadores', { method: 'POST', body }));
      setAberto(false); setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternar(p: Patrocinador) {
    await api(`/admin/patrocinadores/${p.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        nome: p.nome, logoUrl: p.logo_url ?? undefined, bannerUrl: p.banner_url ?? undefined,
        aposCategoriaId: p.apos_categoria_id ?? undefined, ativo: !p.ativo,
        produtos: (p.produtos ?? []).map((i) => ({ produtoId: i.produtoId, precoEspecial: i.precoEspecial ?? undefined })),
      }),
    });
    carregar();
  }

  async function remover(id: string) {
    if (!confirm('Remover este patrocinador?')) return;
    await api(`/admin/patrocinadores/${id}`, { method: 'DELETE' });
    carregar();
  }

  return (
    <>
      <h1>Patrocinadores</h1>
      <div className="filtros">
        <button className="btn" onClick={abrirNovo}>+ Novo patrocinador</button>
      </div>
      {erro && <div className="erro-texto">{erro}</div>}

      {aberto && (
        <form className="card" style={{ marginBottom: 16 }} onSubmit={salvar}>
          <div className="filtros">
            <input placeholder="Nome (ex.: M.Dias Alimentos)" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required style={{ flex: 1, minWidth: 220 }} />
            <select value={form.aposCategoriaId} onChange={(e) => setForm({ ...form, aposCategoriaId: e.target.value })}>
              <option value="">Aparece no topo, antes de tudo</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>Depois de: {c.nome}</option>)}
            </select>
          </div>
          <div className="filtros" style={{ marginTop: 8 }}>
            <label className="btn btn-claro">
              {subindoLogo ? 'Enviando…' : '📁 Logo (redondo)'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => escolherArquivo('logoUrl', setSubindoLogo, e)} style={{ display: 'none' }} />
            </label>
            {form.logoUrl && <img src={form.logoUrl} alt="" style={{ height: 38, width: 38, borderRadius: '50%', objectFit: 'cover' }} />}
            <label className="btn btn-claro">
              {subindoBanner ? 'Enviando…' : '📁 Banner (1400x400)'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => escolherArquivo('bannerUrl', setSubindoBanner, e)} style={{ display: 'none' }} />
            </label>
            {form.bannerUrl && <img src={form.bannerUrl} alt="" style={{ height: 38, borderRadius: 6 }} />}
          </div>
          <div style={{ position: 'relative', margin: '10px 0' }}>
            <input placeholder="Buscar produto para adicionar…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: '100%' }} />
            {sugestoes.length > 0 && (
              <div className="card" style={{ position: 'absolute', zIndex: 5, width: '100%', padding: 6 }}>
                {sugestoes.map((s) => (
                  <div key={s.id} style={{ padding: '7px 10px', cursor: 'pointer' }}
                    onClick={() => {
                      if (!itens.some((i) => i.produtoId === s.id)) {
                        setItens([...itens, { produtoId: s.id, nome: s.nome, sku: s.sku }]);
                      }
                      setBusca(''); setSugestoes([]);
                    }}>
                    {s.nome} <span style={{ color: 'var(--texto-2)' }}>· {s.sku} · {s.preco ? fmtMoeda(s.preco) : 'sem preço'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {itens.map((i, k) => (
            <div key={i.produtoId} className="filtros" style={{ marginBottom: 6 }}>
              <span style={{ flex: 1 }}>{i.nome}</span>
              <input type="number" step="0.01" min="0" placeholder="Preço especial (opcional)" value={i.precoEspecial ?? ''}
                onChange={(e) => setItens(itens.map((x, j) => (j === k ? { ...x, precoEspecial: e.target.value === '' ? undefined : Number(e.target.value) } : x)))}
                style={{ width: 180 }} />
              <button type="button" className="btn-mini btn-perigo" onClick={() => setItens(itens.filter((_, j) => j !== k))}>Remover</button>
            </div>
          ))}
          <div className="filtros" style={{ marginTop: 8 }}>
            <button className="btn">{editando ? 'Salvar patrocinador' : 'Criar patrocinador'}</button>
            <button type="button" className="btn btn-claro" onClick={() => setAberto(false)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="tabela-wrap">
        <table>
          <thead><tr><th>Patrocinador</th><th>Aparece depois de</th><th>Produtos</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.nome}</strong></td>
                <td>{p.apos_categoria_nome ?? 'Topo'}</td>
                <td>{p.produtos?.length ?? 0}</td>
                <td><span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn-mini btn-claro" onClick={() => abrirEdicao(p)}>Editar</button>{' '}
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>{p.ativo ? 'Desativar' : 'Ativar'}</button>{' '}
                  <button className="btn-mini btn-perigo" onClick={() => remover(p.id)}>Remover</button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhum patrocinador</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Edite `apps/admin/src/App.tsx`: adicione o import e a rota.

```tsx
import { Patrocinadores } from './paginas/Patrocinadores';
```

E no array `ROTAS`, logo depois de `['/promocoes', <Promocoes />],`:

```tsx
  ['/patrocinadores', <Patrocinadores />],
```

- [ ] **Step 3: Adicionar no menu**

Edite `apps/admin/src/Layout.tsx`: no array `LINKS`, logo depois de `{ para: '/promocoes', rotulo: '💛 Promoções' },`:

```tsx
  { para: '/patrocinadores', rotulo: '🏭 Patrocinadores' },
```

- [ ] **Step 4: Verificar no navegador**

Em `apps/admin`:

```bash
npx vite --host
```

Abra `http://localhost:5173/patrocinadores` no Chrome (logado como `admin@cahu.com.br` / `cahu@2026`). Crie um patrocinador de teste: nome, categoria "depois de Bebidas", adicione 2 produtos pela busca, salve. Confirme que aparece na tabela com o nome da categoria certo e a contagem de produtos certa. Edite pra trocar pra "Topo". Desative e reative. Remova ao final.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/paginas/Patrocinadores.tsx apps/admin/src/App.tsx apps/admin/src/Layout.tsx
git commit -m "feat(admin): tela de gerenciamento de patrocinadores"
```

---

### Task 5: App Flutter — vitrine patrocinada na Home

**Files:**
- Create: `apps/mobile/lib/widgets/vitrine_patrocinada.dart`
- Modify: `apps/mobile/lib/features/home/home_screen.dart:174-186`
- Modify: `apps/mobile/lib/features/catalog/produtos_screen.dart`

**Interfaces:**
- Consome: campo `tipo` (`'categoria' | 'patrocinador'`) em cada item de `_home!['prateleiras']`, produzido pela Task 3. Reaproveita `ProdutoCard` (`../../widgets/produto_card.dart`).

- [ ] **Step 1: Adicionar suporte a lista fixa de produtos em `ProdutosScreen`**

Em `apps/mobile/lib/features/catalog/produtos_screen.dart`, adicione o parâmetro `produtosFixos` e pule a busca de rede quando ele vier preenchido.

Substitua o construtor (linhas 9-17) por:

```dart
class ProdutosScreen extends StatefulWidget {
  const ProdutosScreen({
    super.key,
    required this.titulo,
    this.categoriaId,
    this.subcategorias = const [],
    this.buscaInicial,
    this.somentePromocao = false,
    this.produtosFixos,
  });

  final String titulo;
  final String? categoriaId;
  final List<Map<String, dynamic>> subcategorias;
  final String? buscaInicial;
  final bool somentePromocao;
  final List<Map<String, dynamic>>? produtosFixos;
```

Substitua o método `_carregarMais` (linhas 72-104) por:

```dart
  Future<void> _carregarMais() async {
    if (_carregando || _fim) return;
    if (widget.produtosFixos != null) {
      setState(() {
        _produtos
          ..clear()
          ..addAll(widget.produtosFixos!);
        _fim = true;
      });
      return;
    }
    setState(() => _carregando = true);
    try {
      final q = <String, String>{
        'pagina': '$_pagina',
        'limite': '$_limite',
        if (_subcategoriaId != null)
          'categoria': _subcategoriaId!
        else if (widget.categoriaId != null)
          'categoria': widget.categoriaId!,
        if (_busca.text.trim().isNotEmpty) 'busca': _busca.text.trim(),
        if (widget.somentePromocao) 'promocao': 'true',
      };
      final query = q.entries
          .map((e) => '${e.key}=${Uri.encodeQueryComponent(e.value)}')
          .join('&');
      final r = await ApiClient.instance.get('/produtos?$query') as Map<String, dynamic>;
      final novos = List<Map<String, dynamic>>.from(r['dados'] as List? ?? const []);
      if (!mounted) return;
      setState(() {
        _produtos.addAll(novos);
        _pagina++;
        if (novos.length < _limite) _fim = true;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }
```

- [ ] **Step 2: Criar o widget da vitrine patrocinada**

Crie `apps/mobile/lib/widgets/vitrine_patrocinada.dart`:

```dart
import 'package:flutter/material.dart';

import '../features/catalog/produtos_screen.dart';
import 'produto_card.dart';

/// Vitrine patrocinada (indústria/fabricante) na Home: banner + logo redondo +
/// nome + carrossel horizontal de produtos + "Ver todos". Dados já vêm
/// embutidos na resposta do GET /v1/home — sem chamada de rede própria.
class VitrinePatrocinada extends StatelessWidget {
  const VitrinePatrocinada({super.key, required this.patrocinador});

  final Map<String, dynamic> patrocinador;

  @override
  Widget build(BuildContext context) {
    final produtos = List<Map<String, dynamic>>.from(patrocinador['produtos'] as List? ?? const []);
    if (produtos.isEmpty) return const SizedBox.shrink();
    final nome = patrocinador['nome'] as String? ?? '';
    final logoUrl = patrocinador['logoUrl'] as String?;
    final bannerUrl = patrocinador['bannerUrl'] as String?;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (bannerUrl != null && bannerUrl.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 20, 16, 0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: AspectRatio(
                aspectRatio: 3.5,
                child: Image.network(
                  bannerUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, e, s) => Container(color: Colors.grey.shade200),
                ),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
          child: Row(
            children: [
              if (logoUrl != null && logoUrl.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(right: 10),
                  child: ClipOval(
                    child: Image.network(logoUrl, width: 32, height: 32, fit: BoxFit.cover,
                        errorBuilder: (_, e, s) => const SizedBox(width: 32, height: 32)),
                  ),
                ),
              Expanded(
                child: Text(nome, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
              ),
              TextButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => ProdutosScreen(titulo: nome, produtosFixos: produtos))),
                child: const Text('Ver todos'),
              ),
            ],
          ),
        ),
        SizedBox(
          height: 254,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: produtos.length,
            separatorBuilder: (_, i) => const SizedBox(width: 10),
            itemBuilder: (_, i) => ProdutoCard(produto: produtos[i], largura: 150),
          ),
        ),
      ],
    );
  }
}
```

- [ ] **Step 3: Integrar na Home**

Em `apps/mobile/lib/features/home/home_screen.dart`, adicione o import:

```dart
import '../../widgets/vitrine_patrocinada.dart';
```

Substitua o bloco do `for` que percorre as prateleiras (linhas 178-186) por:

```dart
                      for (final item in (_home!['prateleiras'] as List? ?? const []))
                        (item as Map<String, dynamic>)['tipo'] == 'patrocinador'
                            ? VitrinePatrocinada(patrocinador: item)
                            : _vitrine(
                                item['nome'] as String,
                                item['produtos'] as List? ?? const [],
                                verTodos: () => Navigator.of(context).push(MaterialPageRoute(
                                    builder: (_) => ProdutosScreen(
                                        categoriaId: item['categoriaId'] as String,
                                        titulo: item['nome'] as String))),
                              ),
```

- [ ] **Step 4: Analisar e rodar**

Em `apps/mobile`:

```bash
flutter analyze
```

Expected: `No issues found!`.

```bash
flutter run
```

Com um patrocinador de teste ativo no banco (recrie um via retaguarda, Task 4 Step 4, e deixe ativo desta vez), confirme visualmente: o banner aparece na posição certa da Home (logo depois da categoria escolhida, ou no topo), o logo redondo e o nome aparecem, o carrossel mostra os produtos, e "Ver todos" abre a lista completa sem fazer nova chamada de rede (teste desligando o Wi-Fi depois que a Home já carregou — "Ver todos" ainda deve funcionar).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/widgets/vitrine_patrocinada.dart apps/mobile/lib/features/home/home_screen.dart apps/mobile/lib/features/catalog/produtos_screen.dart
git commit -m "feat(mobile): vitrine patrocinada na Home"
```

---

## Verificação final (fim a fim)

Depois das 5 tasks, com a API e a retaguarda rodando localmente e um patrocinador de teste ativo:

1. Retaguarda: criar/editar/desativar/remover um patrocinador funciona sem erro (Task 4, Step 4).
2. `curl -H "X-Tenant: cahu" http://localhost:3000/v1/home` mostra o patrocinador ativo na posição certa dentro de `prateleiras` (Task 3, Step 2).
3. App Flutter mostra a vitrine na Home na posição certa, com banner/logo/carrossel, e "Ver todos" funciona (Task 5, Step 4).
4. Com 0 patrocinadores ativos (todos desativados ou removidos), a Home volta a ficar idêntica a antes desta feature — nenhuma vitrine extra aparece.