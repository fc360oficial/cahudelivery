# Desconto Progressivo por Quantidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o admin configurar, por produto, um preço menor por caixa/fardo a partir de uma quantidade mínima ("a partir de N un: R$X") — aplicado de verdade no carrinho/pedido e mostrado como selo informativo nas vitrines do app.

**Architecture:** Reaproveita a descoberta de que `OrdersService.carrinho()` (`apps/api/src/orders/orders.service.ts`) já recalcula o preço ao vivo via SQL, já joinado com a quantidade do item — só estende essa fórmula com um `least(...)` a mais. `criarPedido()` reaproveita `carrinho()`, então o pedido sai certo automaticamente. O app já busca o carrinho inteiro da API a cada mudança de quantidade (`CarrinhoStore._aplicar`), sem lógica de preço no cliente — não precisa mudar nada aí.

**Tech Stack:** NestJS 10, PostgreSQL (SQL cru via `tenantCtx().pool`, sem ORM), React 18 + Vite, Flutter/Dart.

## Global Constraints

- Todo acesso a banco no backend usa `tenantCtx().pool`.
- SQL cru com parâmetros posicionais, nunca concatenação de string com valor do usuário.
- Migração nova em `infra/sql/tenant/NNN_nome.sql` **deve** ser espelhada em `../11 - SQL/NNN_nome.sql` (pasta irmã de `fluxo-commerce`, fora do repo git) e terminar com `insert into schema_migrations (versao) values ('NNN') on conflict do nothing;`.
- Este projeto não usa testes automatizados de backend/mobile para os CRUDs/telas equivalentes (Promoções, Vitrines Patrocinadas, tela Produtos) — verificação estabelecida é manual: `curl` pra API, Chrome pra retaguarda, `flutter analyze` + rodar no dispositivo pro app. Este plano segue a mesma convenção.
- Preço final do item no carrinho é sempre o **menor valor** entre preço da tabela, promoção vigente, e desconto por quantidade (quando a quantidade bate o mínimo) — nunca cobra mais que o melhor desconto disponível.
- `desconto_qtd_minima` e `desconto_qtd_preco` são exclusivos do CAHU Delivery — não sincronizam com o ERP.
- Banco de dev local: `fluxo_t_cahu` (psql em `C:\Program Files\PostgreSQL\16\bin\psql.exe`, usuário `postgres`, senha `postgres`, host `localhost`).
- Admin dev login: `admin@cahu.com.br` / `cahu@2026` (`POST /v1/admin/auth/login`, header `X-Tenant: cahu`).

---

### Task 1: Migração — colunas de desconto por quantidade em `produtos`

**Files:**
- Create: `infra/sql/tenant/008_desconto_quantidade.sql`
- Create: `../11 - SQL/008_desconto_quantidade.sql`

**Interfaces:**
- Produz: colunas `produtos.desconto_qtd_minima` (int, nullable) e `produtos.desconto_qtd_preco` (numeric, nullable), consumidas pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migração**

Crie `infra/sql/tenant/008_desconto_quantidade.sql`:

```sql
-- Desconto progressivo por quantidade (benchmark Praso, 23/07/2026): preço
-- menor por caixa/fardo a partir de uma quantidade mínima. Um único nível
-- por produto. Exclusivo do CAHU Delivery — não sincroniza com o ERP.
alter table produtos add column if not exists desconto_qtd_minima int;
alter table produtos add column if not exists desconto_qtd_preco numeric;

insert into schema_migrations (versao) values ('008') on conflict do nothing;
```

Copie o mesmo conteúdo para `../11 - SQL/008_desconto_quantidade.sql`.

- [ ] **Step 2: Aplicar no banco de dev e verificar**

```powershell
$env:PGPASSWORD='postgres'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -f infra\sql\tenant\008_desconto_quantidade.sql
```

Expected: `ALTER TABLE` x2 (ou nenhum erro se rodar de novo), `INSERT 0 1`.

- [ ] **Step 3: Confirmar as colunas existem**

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -c "\d produtos" | Select-String "desconto_qtd"
```

Expected: duas linhas mostrando `desconto_qtd_minima` (integer) e `desconto_qtd_preco` (numeric).

- [ ] **Step 4: Commit**

```bash
git add "infra/sql/tenant/008_desconto_quantidade.sql" "../11 - SQL/008_desconto_quantidade.sql"
git commit -m "feat(db): colunas de desconto progressivo por quantidade em produtos"
```

---

### Task 2: API admin — editar desconto por quantidade do produto

**Files:**
- Modify: `apps/api/src/admin/admin.controller.ts` (adicionar rota, mesmo padrão de `alternarProduto`)
- Modify: `apps/api/src/admin/admin.service.ts` (adicionar método)

**Interfaces:**
- Consome: `tenantCtx()`, `AdminGuard`/`AdminLogado`/`ReqAdmin` (já existentes no arquivo).
- Produz: `PATCH /admin/produtos/:id/desconto-qtd`, consumido pela Task 4 (retaguarda).

- [ ] **Step 1: Adicionar o DTO e a rota no controller**

Em `apps/api/src/admin/admin.controller.ts`, adicione a classe DTO logo depois de `AtivoDto` (linha 15):

```typescript
class DescontoQtdDto {
  @IsOptional() @IsInt() @Min(1) descontoQtdMinima?: number;
  @IsOptional() @IsNumber() @Min(0) descontoQtdPreco?: number;
}
```

Atualize o import do topo (linha 2) para incluir os novos decorators:

```typescript
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
```

Adicione a rota logo depois de `alternarProduto` (depois da linha 65):

```typescript
  @Patch('produtos/:id/desconto-qtd')
  descontoQtd(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DescontoQtdDto) {
    return this.admin.descontoQtdProduto(id, dto.descontoQtdMinima ?? null, dto.descontoQtdPreco ?? null, req.admin.usuarioId);
  }
```

- [ ] **Step 2: Adicionar o método no service**

Em `apps/api/src/admin/admin.service.ts`, adicione logo depois de `alternarProduto` (depois da linha 226):

```typescript
  async descontoQtdProduto(id: string, minima: number | null, preco: number | null, usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(
      `update produtos set desconto_qtd_minima = $2, desconto_qtd_preco = $3 where id = $1 returning id`,
      [id, minima, preco],
    );
    if (!r.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'editar_desconto_qtd','produto',$2,$3)`,
      [usuarioId, id, JSON.stringify({ descontoQtdMinima: minima, descontoQtdPreco: preco })],
    );
    return { ok: true };
  }
```

- [ ] **Step 3: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: log de inicialização sem erro.

- [ ] **Step 4: Verificar manualmente com curl**

Faça login e pegue o token (`admin@cahu.com.br` / `cahu@2026`), pegue um produto real (`select id from produtos limit 1` no `fluxo_t_cahu`), então:

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/produtos/<PRODUTO_ID>/desconto-qtd \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"descontoQtdMinima":4,"descontoQtdPreco":39.90}'
```

Expected: `{"ok":true}`.

```bash
$env:PGPASSWORD='postgres'; & 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -c "select desconto_qtd_minima, desconto_qtd_preco from produtos where id = '<PRODUTO_ID>'"
```

Expected: `4` e `39.90` (ou `39.9`) nas colunas.

Remova o desconto de teste ao final (mande `descontoQtdMinima`/`descontoQtdPreco` ausentes ou `null` no body, ou rode um UPDATE direto pra limpar):

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/produtos/<PRODUTO_ID>/desconto-qtd \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.service.ts
git commit -m "feat(api): endpoint admin pra editar desconto progressivo por quantidade"
```

---

### Task 3: API — preço com desconto no carrinho + exposição pro selo no catálogo

**Files:**
- Modify: `apps/api/src/orders/orders.service.ts:24-46` (método `carrinho`)
- Modify: `apps/api/src/catalog/catalog.service.ts` (constante `SELECT_PRODUTO`, topo do arquivo)

**Interfaces:**
- Consome: colunas da Task 1.
- Produz: `preco_atual` em `GET /v1/carrinho` (e portanto em `POST /v1/pedidos`, que reaproveita `carrinho()`) já considerando o desconto; campos `desconto_qtd_minima`/`desconto_qtd_preco` nos produtos retornados por `/v1/produtos`, `/v1/home`, `/v1/produtos/:id` (via `SELECT_PRODUTO`), consumidos pela Task 5 (app).

- [ ] **Step 1: Atualizar o cálculo de preço do carrinho**

Em `apps/api/src/orders/orders.service.ts`, no método `carrinho` (linhas 24-46), troque a linha:

```sql
              coalesce(promo.preco_promocional, pr.preco) as preco_atual
```

por:

```sql
              least(
                coalesce(promo.preco_promocional, pr.preco),
                case when p.desconto_qtd_minima is not null and ci.quantidade >= p.desconto_qtd_minima
                     then p.desconto_qtd_preco else pr.preco end
              ) as preco_atual
```

O restante do método (joins, params) não muda — `p` já está no `from`/`join` da query.

- [ ] **Step 2: Expor os campos no catálogo público**

Em `apps/api/src/catalog/catalog.service.ts`, na constante `SELECT_PRODUTO` (topo do arquivo), adicione as duas colunas na lista do `select` (logo depois de `p.qtd_minima,`):

```sql
         p.desconto_qtd_minima, p.desconto_qtd_preco,
```

Não muda o cálculo de `preco` nessa query — esses dois campos são só pra exibição do selo (Task 5), o preço de vitrine continua quantidade-independente.

- [ ] **Step 3: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

- [ ] **Step 4: Verificar o carrinho com curl**

Configure o desconto de teste no mesmo produto da Task 2 (`descontoQtdMinima: 4, descontoQtdPreco: 39.90`, preço normal deve ser maior que isso — confira com `select preco from precos where produto_id = '<PRODUTO_ID>'`). Cadastre um cliente de teste ou use um device anônimo (header `X-Device-Id: teste-desconto-qtd`):

```bash
curl -s -X PUT http://localhost:3000/v1/carrinho/itens \
  -H "X-Tenant: cahu" -H "X-Device-Id: teste-desconto-qtd" -H "Content-Type: application/json" \
  -d '{"produtoId":"<PRODUTO_ID>","quantidade":2}'
```

Expected: `preco_atual` do item é o preço normal (2 < 4, desconto não bate).

```bash
curl -s -X PUT http://localhost:3000/v1/carrinho/itens \
  -H "X-Tenant: cahu" -H "X-Device-Id: teste-desconto-qtd" -H "Content-Type: application/json" \
  -d '{"produtoId":"<PRODUTO_ID>","quantidade":4}'
```

Expected: `preco_atual` do item agora é `39.9` (4 >= 4, desconto aplicado).

Limpe o carrinho de teste ao final:

```bash
curl -s -X DELETE "http://localhost:3000/v1/carrinho/itens/<PRODUTO_ID>" -H "X-Tenant: cahu" -H "X-Device-Id: teste-desconto-qtd"
```

- [ ] **Step 5: Verificar o catálogo com curl**

```bash
curl -s -H "X-Tenant: cahu" "http://localhost:3000/v1/produtos/<PRODUTO_ID>"
```

Expected: JSON inclui `"desconto_qtd_minima":4` e `"desconto_qtd_preco":"39.90"` (ou `39.9`).

Remova o desconto de teste do produto ao final (mesmo comando do Step 4 da Task 2, body `{}`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orders/orders.service.ts apps/api/src/catalog/catalog.service.ts
git commit -m "feat(api): aplica desconto progressivo no preco do carrinho e expoe no catalogo"
```

---

### Task 4: Retaguarda — editar desconto progressivo na tela Produtos

**Files:**
- Modify: `apps/admin/src/paginas/Produtos.tsx`

**Interfaces:**
- Consome: `api()` de `../api`, endpoint `PATCH /admin/produtos/:id/desconto-qtd` da Task 2, campos `desconto_qtd_minima`/`desconto_qtd_preco` já retornados por `GET /admin/produtos` (mesma query base que já inclui todas as colunas de `produtos` — confirme lendo `admin.service.ts` `produtos()` antes de assumir; se as duas colunas novas não vierem no `select` dessa query, adicione-as lá também, seguindo o mesmo padrão das colunas existentes).

- [ ] **Step 1: Atualizar a query de listagem admin**

Em `apps/api/src/admin/admin.service.ts`, método `produtos` (linha 191), o `select` (linha 201) começa com:

```sql
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, c.nome as categoria, m.nome as marca,
```

Troque essa linha por (adicionando as duas colunas novas logo depois de `p.ativo,`):

```sql
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco,
              c.nome as categoria, m.nome as marca,
```

O restante da query (linhas 202+) não muda. Rebuild e reinicie a API: `npm run build && node dist/main.js` em `apps/api`.

- [ ] **Step 2: Atualizar o componente**

Em `apps/admin/src/paginas/Produtos.tsx`, substitua o arquivo inteiro por:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { api, fmtMoeda } from '../api';

interface LinhaProduto {
  id: string;
  sku: string;
  nome: string;
  unidade_venda: string;
  ativo: boolean;
  categoria?: string;
  marca?: string;
  estoque: string;
  preco?: string;
  desconto_qtd_minima?: number;
  desconto_qtd_preco?: string;
}

export function Produtos() {
  const [busca, setBusca] = useState('');
  const [dados, setDados] = useState<LinhaProduto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [minimaEdit, setMinimaEdit] = useState('');
  const [precoEdit, setPrecoEdit] = useState('');

  const carregar = useCallback(() => {
    const q = busca ? `?busca=${encodeURIComponent(busca)}` : '';
    api<{ dados: LinhaProduto[] }>(`/admin/produtos${q}`)
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, [busca]);

  useEffect(carregar, [carregar]);

  async function alternar(p: LinhaProduto) {
    try {
      await api(`/admin/produtos/${p.id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo: !p.ativo }) });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  function abrirEdicaoDesconto(p: LinhaProduto) {
    setEditandoId(p.id);
    setMinimaEdit(p.desconto_qtd_minima != null ? String(p.desconto_qtd_minima) : '');
    setPrecoEdit(p.desconto_qtd_preco != null ? String(p.desconto_qtd_preco) : '');
  }

  async function salvarDesconto(id: string) {
    try {
      const minima = minimaEdit.trim() === '' ? undefined : Number(minimaEdit);
      const preco = precoEdit.trim() === '' ? undefined : Number(precoEdit);
      await api(`/admin/produtos/${id}/desconto-qtd`, {
        method: 'PATCH',
        body: JSON.stringify({ descontoQtdMinima: minima, descontoQtdPreco: preco }),
      });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function removerDesconto(id: string) {
    try {
      await api(`/admin/produtos/${id}/desconto-qtd`, { method: 'PATCH', body: JSON.stringify({}) });
      setEditandoId(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <h1>Produtos</h1>
      <div className="filtros">
        <input placeholder="Buscar por nome ou SKU…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, maxWidth: 340 }} />
      </div>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Situação</th><th></th></tr>
          </thead>
          <tbody>
            {dados?.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.sku}</td>
                <td><strong>{p.nome}</strong>{p.marca ? <span style={{ color: 'var(--texto-2)' }}> · {p.marca}</span> : null}</td>
                <td>{p.categoria ?? '—'}</td>
                <td>{p.unidade_venda}</td>
                <td>{Number(p.estoque)}</td>
                <td>{p.preco ? fmtMoeda(p.preco) : '—'}</td>
                <td>
                  {editandoId === p.id ? (
                    <div className="filtros" style={{ flexWrap: 'nowrap' }}>
                      <input type="number" min="1" placeholder="A partir de" value={minimaEdit}
                        onChange={(e) => setMinimaEdit(e.target.value)} style={{ width: 90 }} />
                      <input type="number" step="0.01" min="0" placeholder="Preço" value={precoEdit}
                        onChange={(e) => setPrecoEdit(e.target.value)} style={{ width: 100 }} />
                      <button className="btn-mini btn-ok" onClick={() => salvarDesconto(p.id)}>Salvar</button>
                      <button className="btn-mini btn-claro" onClick={() => setEditandoId(null)}>Cancelar</button>
                    </div>
                  ) : p.desconto_qtd_minima != null ? (
                    <span>
                      a partir de {p.desconto_qtd_minima} un: {fmtMoeda(p.desconto_qtd_preco)}{' '}
                      <button className="btn-mini btn-claro" onClick={() => abrirEdicaoDesconto(p)}>Editar</button>{' '}
                      <button className="btn-mini btn-perigo" onClick={() => removerDesconto(p.id)}>Remover</button>
                    </span>
                  ) : (
                    <button className="btn-mini btn-claro" onClick={() => abrirEdicaoDesconto(p)}>+ Adicionar</button>
                  )}
                </td>
                <td><span className={`badge ${p.ativo ? 'aprovado' : 'bloqueado'}`}>{p.ativo ? 'ativo' : 'inativo'}</span></td>
                <td>
                  <button className={`btn-mini ${p.ativo ? 'btn-perigo' : 'btn-ok'}`} onClick={() => alternar(p)}>
                    {p.ativo ? 'Desativar' : 'Ativar'}
                  </button>
                </td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={9} className="vazio">Nenhum produto — aguarde a sincronização do ERP</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verificar o build**

```bash
cd apps/admin
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 4: Verificar no navegador**

```bash
npx vite --host
```

Abra `http://localhost:5173/produtos`, logado como admin. Clique em "+ Adicionar" num produto, preencha "a partir de 4" e um preço menor que o normal, salve — confirme que a célula mostra "a partir de 4 un: R$X". Clique em "Editar", mude o valor, salve de novo. Clique em "Remover" e confirme que volta pro botão "+ Adicionar".

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/paginas/Produtos.tsx apps/api/src/admin/admin.service.ts
git commit -m "feat(admin): edicao de desconto progressivo por quantidade na tela Produtos"
```

---

### Task 5: App Flutter — selo de desconto progressivo no card do produto

**Files:**
- Modify: `apps/mobile/lib/widgets/produto_card.dart`

**Interfaces:**
- Consome: campos `desconto_qtd_minima`/`desconto_qtd_preco` no mapa `produto` (produzidos pela Task 3).

- [ ] **Step 1: Adicionar o selo**

Em `apps/mobile/lib/widgets/produto_card.dart`, no método estático `_blocoPreco` (linhas 115-152), adicione o selo de desconto progressivo logo depois do bloco do selo de fardo/caixa existente (depois do `if (porEmb > 1) Padding(...)`, ainda dentro do mesmo `Column`). Primeiro, no início do método `_blocoPreco`, adicione a leitura dos novos campos:

```dart
  static Widget _blocoPreco(Map<String, dynamic> produto, ColorScheme tema, bool emPromocao) {
    final porEmb = asDouble(produto['qtd_por_embalagem']);
    final sigla = siglaUnidade(produto);
    final unit = precoUnitario(produto);
    final cor = emPromocao ? Colors.red.shade600 : tema.primary;
    final descontoQtdMinima = produto['desconto_qtd_minima'] as int?;
    final descontoQtdPreco = produto['desconto_qtd_preco'];
```

E adicione o novo trecho de UI como último filho do `Column` retornado (depois do bloco `if (porEmb > 1) Padding(...)` existente, antes do fechamento `],\n    );`):

```dart
        if (descontoQtdMinima != null && descontoQtdPreco != null)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                'a partir de $descontoQtdMinima un: ${moeda(descontoQtdPreco)}',
                style: TextStyle(
                    fontSize: 10.5, fontWeight: FontWeight.w700, color: Colors.green.shade800),
              ),
            ),
          ),
```

- [ ] **Step 2: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 3: Rodar e verificar visualmente**

Com um produto de teste tendo `desconto_qtd_minima`/`desconto_qtd_preco` configurados via retaguarda (Task 4), rode o app (`flutter run`, apontando pro servidor com a API rodando) e confirme que o card desse produto mostra o selo verde "a partir de N un: R$X" abaixo do preço, e que produtos sem desconto configurado não mostram nada extra (sem regressão visual nos demais cards).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/widgets/produto_card.dart
git commit -m "feat(mobile): selo de desconto progressivo por quantidade no card do produto"
```

---

## Verificação final (fim a fim)

Com a API e a retaguarda rodando localmente e um produto de teste configurado (Task 2/4):

1. Retaguarda: adicionar/editar/remover o desconto por quantidade na tela Produtos funciona sem erro.
2. Card do produto no app mostra o selo "a partir de N un: R$X".
3. Adicionar menos que N unidades no carrinho mantém o preço normal; ao atingir N, o preço do item no carrinho cai pro valor configurado (confirmar via `GET /v1/carrinho` ou visualmente no app).
4. Fechar um pedido com quantidade acima do mínimo grava o preço com desconto em `pedido_itens` (consequência automática de `criarPedido` reaproveitar `carrinho()` — conferir com uma consulta rápida em `pedido_itens` depois de um pedido de teste, se quiser confirmação extra).
5. Produto sem desconto configurado não muda nada (sem selo, preço igual a antes).