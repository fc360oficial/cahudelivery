# Upload de Foto de Produto (retaguarda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o admin subir/trocar/remover a foto de capa de um produto direto na tabela de
Produtos da retaguarda, sem migração de banco (a tabela `produto_imagens` já existe e já é lida
pelo app).

**Architecture:** Dois endpoints novos em `AdminController`/`AdminService` (mesmo padrão de
`alternarProduto`/`descontoQtdProduto`: SQL direto via `pool.query`, sem ORM, com linha de
auditoria). A "foto de capa" é sempre a linha de menor `ordem` em `produto_imagens` para aquele
`produto_id` — convenção que `catalog.service.ts` e o app Flutter já usam pra escolher a
miniatura. No frontend, uma coluna nova em `Produtos.tsx` reaproveita o helper `upload()` que já
existe (usado hoje em Banners).

**Tech Stack:** NestJS 11 + `pg` (SQL cru, sem ORM), React 19 + Vite (sem framework de estado),
TypeScript em ambos.

## Global Constraints

- Nenhuma migração de banco — a tabela `produto_imagens` (`produto_id`, `url`, `ordem`, `origem`)
  já existe em produção e em dev.
- Escopo é **uma foto de capa por produto** (não múltiplas fotos/galeria) — spec:
  `docs/superpowers/specs/2026-08-05-foto-produto-design.md`.
- Reaproveitar `POST /admin/upload` (já existe, `admin-upload.controller.ts`) para o arquivo em
  si — os endpoints novos só recebem a URL já hospedada e gravam/apagam a linha em
  `produto_imagens`.
- Este projeto não usa Jest para as features de negócio (só o `app.controller.spec.ts` default do
  Nest existe e nunca foi estendido) — toda a base de código foi validada até aqui com `curl` real
  contra API+Postgres locais rodando, e checagem visual no navegador para UI. Seguir essa mesma
  convenção aqui, não introduzir um `.spec.ts` novo.
- Toda rota da API fica sob o prefixo global `/v1` (`app.setGlobalPrefix('v1')` em `main.ts`) —
  ex.: o controller `@Controller('admin')` responde em `/v1/admin/...`.
- Toda request (admin ou cliente) precisa do header `X-Tenant: cahu` em dev.

---

### Task 1: Backend — endpoints de definir/remover foto de capa do produto

**Files:**
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.service.ts`

**Interfaces:**
- Produces: `AdminService.definirImagemProduto(produtoId: string, url: string, usuarioId: string): Promise<{ ok: true }>`
- Produces: `AdminService.removerImagemProduto(produtoId: string, usuarioId: string): Promise<{ ok: true }>`
- Produces: rotas `PUT /v1/admin/produtos/:id/imagem` (body `{ url: string }`) e
  `DELETE /v1/admin/produtos/:id/imagem` — ambas exigem `Authorization: Bearer <token admin>` e
  `X-Tenant`, retornam 404 se o produto não existir.
- Produces: `AdminService.produtos()` passa a devolver `imagem_url: string | null` em cada linha
  (consumido pelo Task 2 no frontend).

- [ ] **Step 1: Adicionar o DTO e o import que falta em `admin.controller.ts`**

Em `apps/api/src/admin/admin.controller.ts`, troque a linha de import do `class-validator`
(linha 2) para incluir `IsNotEmpty`:

```ts
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
```

E troque o import do `@nestjs/common` (linha 1) para incluir `Put`:

```ts
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
```

Logo depois da classe `ValidadeDto` (que termina com `dataValidade?: string;\n}`), adicione:

```ts
class ImagemProdutoDto {
  @IsNotEmpty() @IsString() url!: string;
}
```

- [ ] **Step 2: Adicionar as duas rotas em `AdminController`**

Logo depois do método `validade(...)` (o que chama `this.admin.validadeProduto(...)`) e antes do
`@Get('logs/integracao')`, adicione:

```ts
  @Put('produtos/:id/imagem')
  definirImagemProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ImagemProdutoDto) {
    return this.admin.definirImagemProduto(id, dto.url, req.admin.usuarioId);
  }

  @Delete('produtos/:id/imagem')
  removerImagemProduto(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.removerImagemProduto(id, req.admin.usuarioId);
  }
```

- [ ] **Step 3: Adicionar os dois métodos em `AdminService`**

Em `apps/api/src/admin/admin.service.ts`, logo depois do método `validadeProduto(...)` (termina
com `return { ok: true };\n  }` antes de `async logsIntegracao`), adicione:

```ts
  async definirImagemProduto(produtoId: string, url: string, usuarioId: string) {
    const { pool } = tenantCtx();
    const produto = await pool.query(`select 1 from produtos where id = $1`, [produtoId]);
    if (!produto.rowCount) throw new NotFoundException('Produto não encontrado');
    const capa = await pool.query(
      `select id from produto_imagens where produto_id = $1 order by ordem asc limit 1`,
      [produtoId],
    );
    if (capa.rowCount) {
      await pool.query(`update produto_imagens set url = $2 where id = $1`, [capa.rows[0].id, url]);
    } else {
      await pool.query(
        `insert into produto_imagens (produto_id, url, ordem, origem) values ($1, $2, 0, 'retaguarda')`,
        [produtoId, url],
      );
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'definir_imagem_produto','produto',$2,$3)`,
      [usuarioId, produtoId, JSON.stringify({ url })],
    );
    return { ok: true };
  }

  async removerImagemProduto(produtoId: string, usuarioId: string) {
    const { pool } = tenantCtx();
    const produto = await pool.query(`select 1 from produtos where id = $1`, [produtoId]);
    if (!produto.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(
      `delete from produto_imagens where id = (
         select id from produto_imagens where produto_id = $1 order by ordem asc limit 1
       )`,
      [produtoId],
    );
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'remover_imagem_produto','produto',$2,$3)`,
      [usuarioId, produtoId, JSON.stringify({})],
    );
    return { ok: true };
  }
```

- [ ] **Step 4: Incluir `imagem_url` na listagem de produtos**

No mesmo arquivo, dentro do método `produtos(f: { busca?: string; pagina: number })`, o `select`
atual é:

```ts
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco, p.data_validade,
              c.nome as categoria, m.nome as marca,
              coalesce(e.quantidade,0) as estoque,
              (select preco from precos pr join tabelas_preco t on t.id = pr.tabela_preco_id and t.padrao
                where pr.produto_id = p.id) as preco
         from produtos p
```

Troque por (linha nova adicionada logo antes do `from`):

```ts
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco, p.data_validade,
              c.nome as categoria, m.nome as marca,
              coalesce(e.quantidade,0) as estoque,
              (select preco from precos pr join tabelas_preco t on t.id = pr.tabela_preco_id and t.padrao
                where pr.produto_id = p.id) as preco,
              (select url from produto_imagens where produto_id = p.id order by ordem asc limit 1) as imagem_url
         from produtos p
```

- [ ] **Step 5: Subir a API local e verificar que compila**

```bash
cd apps/api
npm run start:dev
```

Expected: log do Nest mostrando os módulos carregando sem erro de TypeScript e a linha final
`Nest application successfully started` (ou equivalente). Deixe esse terminal rodando pros
próximos passos — a API sobe em `http://localhost:3000`, prefixo `/v1`.

- [ ] **Step 6: Login como admin de dev e guardar o token**

Em outro terminal:

```bash
curl -s -X POST http://localhost:3000/v1/admin/auth/login \
  -H "X-Tenant: cahu" -H "Content-Type: application/json" \
  -d '{"email":"admin@cahu.com.br","senha":"cahu@2026"}'
```

Expected: JSON com `accessToken`, `nome`, `papel`, `distribuidora`. Copie o valor de
`accessToken` e exporte:

```bash
TOKEN="<cole aqui o accessToken>"
```

- [ ] **Step 7: Listar produtos e escolher um SEM foto pra testar o caminho de INSERT**

```bash
curl -s http://localhost:3000/v1/admin/produtos \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: JSON `{ "dados": [...], "pagina": 1 }`, cada item agora com o campo `imagem_url`
(pode vir preenchido pros produtos do seed de 16/07 que já têm foto, ou `null` pros demais).
Escolha um produto com `"imagem_url": null` e copie o `id`:

```bash
PRODUTO_ID="<cole aqui um id com imagem_url null>"
```

- [ ] **Step 8: Definir a foto de capa (caminho INSERT) e verificar**

```bash
curl -s -X PUT "http://localhost:3000/v1/admin/produtos/$PRODUTO_ID/imagem" \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://images.pexels.com/photos/1092730/pexels-photo-1092730.jpeg"}'
```

Expected: `{"ok":true}`

```bash
curl -s "http://localhost:3000/v1/produtos/$PRODUTO_ID" -H "X-Tenant: cahu"
```

Expected: JSON do produto com `"imagens":[{"url":"https://images.pexels.com/photos/1092730/pexels-photo-1092730.jpeg","ordem":0}]`.

- [ ] **Step 9: Trocar a foto (caminho UPDATE) e confirmar que não duplica**

```bash
curl -s -X PUT "http://localhost:3000/v1/admin/produtos/$PRODUTO_ID/imagem" \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://images.pexels.com/photos/1656666/pexels-photo-1656666.jpeg"}'

curl -s "http://localhost:3000/v1/produtos/$PRODUTO_ID" -H "X-Tenant: cahu"
```

Expected: o array `imagens` continua com **exatamente 1 item**, agora com a URL nova
(`.../1656666/...`) — confirma que atualizou a linha existente em vez de inserir outra.

- [ ] **Step 10: Remover a foto e confirmar**

```bash
curl -s -X DELETE "http://localhost:3000/v1/admin/produtos/$PRODUTO_ID/imagem" \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"

curl -s "http://localhost:3000/v1/produtos/$PRODUTO_ID" -H "X-Tenant: cahu"
```

Expected: `{"ok":true}` no delete; no GET seguinte, `"imagens":null` (ou ausência do campo,
dependendo de como o `catalog.service.ts` monta o JSON quando o subselect não acha nada — o
importante é não aparecer mais a URL).

- [ ] **Step 11: Confirmar 404 para produto inexistente**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  "http://localhost:3000/v1/admin/produtos/00000000-0000-0000-0000-000000000000/imagem" \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"url":"https://exemplo.com/x.jpg"}'
```

Expected: `404`

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.service.ts
git commit -m "feat(api): endpoints para definir/remover foto de capa do produto"
```

---

### Task 2: Frontend — coluna "Foto" na tela de Produtos

**Files:**
- Modify: `apps/admin/src/paginas/Produtos.tsx`

**Interfaces:**
- Consumes: `upload(arquivo: File): Promise<string>` de `../api` (já existe).
- Consumes: `api<T>(path: string, init?: RequestInit): Promise<T>` de `../api` (já existe).
- Consumes: `PUT /v1/admin/produtos/:id/imagem` e `DELETE /v1/admin/produtos/:id/imagem` do
  Task 1.
- Consumes: campo `imagem_url?: string` que `GET /admin/produtos` agora devolve (Task 1, Step 4).

- [ ] **Step 1: Atualizar a interface `LinhaProduto` e o import**

Em `apps/admin/src/paginas/Produtos.tsx`, troque a linha de import (linha 2):

```ts
import { api, fmtMoeda } from '../api';
```

por:

```ts
import { api, fmtMoeda, upload } from '../api';
```

E na interface `LinhaProduto`, adicione o campo depois de `data_validade?: string;`:

```ts
  imagem_url?: string;
```

- [ ] **Step 2: Adicionar o estado `subindoId` e as duas funções**

Dentro do componente `Produtos()`, logo depois da linha
`const [validadeEdit, setValidadeEdit] = useState('');`, adicione:

```ts
  const [subindoId, setSubindoId] = useState<string | null>(null);
```

Logo depois da função `carregar` e do `useEffect(carregar, [carregar]);` (antes de `async
function alternar(p: LinhaProduto) {`), adicione:

```ts
  async function escolherFoto(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    setSubindoId(id);
    try {
      const url = await upload(arquivo);
      await api(`/admin/produtos/${id}/imagem`, { method: 'PUT', body: JSON.stringify({ url }) });
      setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSubindoId(null);
      e.target.value = '';
    }
  }

  async function removerFoto(id: string) {
    if (!confirm('Remover a foto deste produto?')) return;
    try {
      await api(`/admin/produtos/${id}/imagem`, { method: 'DELETE' });
      setErro(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }
```

- [ ] **Step 3: Adicionar a coluna "Foto" no cabeçalho da tabela**

Troque:

```jsx
            <tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Validade</th><th>Situação</th><th></th></tr>
```

por:

```jsx
            <tr><th>Foto</th><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Validade</th><th>Situação</th><th></th></tr>
```

- [ ] **Step 4: Adicionar a célula "Foto" em cada linha**

Troque o início do `<tr key={p.id}>` (a primeira `<td>` da linha, que hoje é
`<td className="mono">{p.sku}</td>`) — adicione a célula nova ANTES dela:

```jsx
              <tr key={p.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <label style={{ cursor: subindoId === p.id ? 'default' : 'pointer' }}>
                      {p.imagem_url ? (
                        <img src={p.imagem_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                      ) : (
                        <div style={{
                          width: 40, height: 40, borderRadius: 6, background: 'var(--fundo)',
                          border: '1px dashed var(--borda)', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', color: 'var(--texto-2)', fontSize: 10,
                        }}>
                          {subindoId === p.id ? '…' : 'foto'}
                        </div>
                      )}
                      <input type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => escolherFoto(p.id, e)} disabled={subindoId === p.id}
                        style={{ display: 'none' }} />
                    </label>
                    {p.imagem_url && (
                      <button type="button" className="btn-mini btn-perigo" title="Remover foto"
                        onClick={() => removerFoto(p.id)}>×</button>
                    )}
                  </div>
                </td>
                <td className="mono">{p.sku}</td>
```

(o resto das células da linha continua igual, sem mudança)

- [ ] **Step 5: Ajustar o `colSpan` da linha "Nenhum produto" e adicionar o texto de ajuda**

Troque:

```jsx
            {dados && !dados.length && <tr><td colSpan={10} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
```

por:

```jsx
            {dados && !dados.length && <tr><td colSpan={11} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
```

E logo depois do `</div>` que fecha `tabela-wrap` (antes do `</>` final), adicione:

```jsx
      <small style={{ color: 'var(--texto-2)', display: 'block', marginTop: 8 }}>
        Foto quadrada, ideal 800×800, até 5MB (PNG/JPG/WEBP).
      </small>
```

- [ ] **Step 6: Verificar que compila**

```bash
cd apps/admin
npm run build
```

Expected: `tsc -b && vite build` terminando sem erro, com o resumo de tamanho dos chunks no
final (mesmo formato usado nas últimas builds do projeto).

- [ ] **Step 7: Checagem visual no navegador**

Com a API do Task 1 ainda rodando (`npm run start:dev` em `apps/api`), suba o admin em modo dev:

```bash
cd apps/admin
npm run dev
```

Abra `http://localhost:5173`, logue com `admin@cahu.com.br` / `cahu@2026`, vá em Produtos e
confirme visualmente:
- Produtos sem foto mostram o placeholder tracejado com o texto "foto".
- Produtos com foto (os do seed de 16/07) mostram a miniatura 40×40 e o botão **×**.
- Clicar no placeholder de um produto sem foto, escolher uma imagem local do computador, e ver a
  miniatura aparecer na tabela sem precisar recarregar a página manualmente.
- Clicar no **×** de um produto com foto remove a foto e ele volta a mostrar o placeholder.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/paginas/Produtos.tsx
git commit -m "feat(admin): coluna de foto de capa na tela de Produtos"
```

---

## Depois do plano

Backlog fora de escopo (já registrado na spec): múltiplas fotos/galeria, importação em lote por
SKU, distinção visual `origem='erp'` vs `'retaguarda'` (só relevante a partir da Fase 4/Dlinks).
Aplicar em produção (Servidor_BI) segue o mesmo fluxo já usado nas últimas features: `git push`,
depois `git pull` + rebuild + restart do serviço `FluxoAPI` no servidor (sem migração dessa vez).