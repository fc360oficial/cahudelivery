# Vencimento Próximo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar uma vitrine "Vencimento Próximo" na Home com produtos perto da data de validade, e o selo "Val. DD/MM" no card do produto.

**Architecture:** Validade é um único campo `data_validade` (date, nullable) em `produtos`, editado manualmente na retaguarda (não sincroniza com o ERP). Limite de dias configurável globalmente via a mesma tabela `configuracoes` já usada pelo limite de estoque baixo. A vitrine reaproveita o helper `_vitrine(...)` que já existe no `home_screen.dart` (usado por "Promoções"/"Mais vendidos") — nenhum widget novo no app.

**Tech Stack:** NestJS 10, PostgreSQL (SQL cru via `tenantCtx().pool`), React 18 + Vite, Flutter/Dart.

## Global Constraints

- Validade é **por produto, uma data só** (não por lote).
- Limite de dias (`dias_vencimento_proximo`) configurado globalmente; `0` ou ausente desativa a seção inteira (nenhuma mudança de comportamento pra quem não configurou).
- `data_validade` e `dias_vencimento_proximo` são exclusivos do CAHU Delivery — não sincronizam com o ERP.
- Este projeto não usa testes automatizados de backend/mobile para os CRUDs/telas equivalentes — verificação estabelecida é manual: `curl` pra API, Chrome pra retaguarda, `flutter analyze` + rodar no dispositivo pro app.
- Banco de dev local: `fluxo_t_cahu` (psql em `C:\Program Files\PostgreSQL\16\bin\psql.exe`, usuário `postgres`, senha `postgres`, host `localhost`). Admin dev login: `admin@cahu.com.br` / `cahu@2026` (`POST /v1/admin/auth/login`, header `X-Tenant: cahu`).

---

### Task 1: Migração — coluna de validade em `produtos`

**Files:**
- Create: `infra/sql/tenant/009_validade_produto.sql`
- Create: `../11 - SQL/009_validade_produto.sql`

**Interfaces:**
- Produz: coluna `produtos.data_validade` (date, nullable), consumida pelas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migração**

Crie `infra/sql/tenant/009_validade_produto.sql`:

```sql
-- Seção "Vencimento Próximo" (benchmark Praso, 24/07/2026): data de validade
-- por produto (não por lote). Exclusivo do CAHU Delivery — não sincroniza com o ERP.
alter table produtos add column if not exists data_validade date;

insert into schema_migrations (versao) values ('009') on conflict do nothing;
```

Copie o mesmo conteúdo para `../11 - SQL/009_validade_produto.sql`.

- [ ] **Step 2: Aplicar no banco de dev e verificar**

```powershell
$env:PGPASSWORD='postgres'
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -f infra\sql\tenant\009_validade_produto.sql
```

Expected: `ALTER TABLE`, `INSERT 0 1`.

```powershell
& 'C:\Program Files\PostgreSQL\16\bin\psql.exe' -U postgres -h localhost -d fluxo_t_cahu -c "\d produtos" | Select-String "data_validade"
```

Expected: uma linha mostrando `data_validade` (date).

- [ ] **Step 3: Commit**

```bash
git add "infra/sql/tenant/009_validade_produto.sql" "../11 - SQL/009_validade_produto.sql"
git commit -m "feat(db): coluna de validade do produto (vencimento proximo)"
```

---

### Task 2: Backend admin — chave de configuração + endpoint de editar validade

**Files:**
- Modify: `apps/api/src/admin/admin-config.controller.ts:41`
- Modify: `apps/api/src/admin/admin.controller.ts` (DTO + rota, mesmo padrão de `DescontoQtdDto`/`descontoQtd`)
- Modify: `apps/api/src/admin/admin.service.ts` (método novo + query de listagem)

**Interfaces:**
- Produz: chave `dias_vencimento_proximo` aceita por `GET/PATCH /admin/configuracoes` (consumida pela Task 4, retaguarda, e pela Task 3, API pública); `PATCH /admin/produtos/:id/validade` (consumido pela Task 4).

- [ ] **Step 1: Liberar a chave de configuração**

Em `apps/api/src/admin/admin-config.controller.ts`, troque a linha 41:

```typescript
const CHAVES_PERMITIDAS = ['pedido_minimo', 'formas_pagamento', 'aprovacao_cadastro', 'horario_atendimento', 'limite_estoque_baixo'];
```

por:

```typescript
const CHAVES_PERMITIDAS = ['pedido_minimo', 'formas_pagamento', 'aprovacao_cadastro', 'horario_atendimento', 'limite_estoque_baixo', 'dias_vencimento_proximo'];
```

- [ ] **Step 2: Adicionar o DTO e a rota no controller**

Em `apps/api/src/admin/admin.controller.ts`, adicione a classe DTO logo depois de `DescontoQtdDto` (linha 20):

```typescript
class ValidadeDto {
  @IsOptional() @IsDateString() dataValidade?: string;
}
```

Atualize o import do topo (linha 2) pra incluir `IsDateString`:

```typescript
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';
```

Adicione a rota logo depois de `descontoQtd` (depois da linha 75):

```typescript
  @Patch('produtos/:id/validade')
  validade(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ValidadeDto) {
    return this.admin.validadeProduto(id, dto.dataValidade ?? null, req.admin.usuarioId);
  }
```

- [ ] **Step 3: Adicionar o método e atualizar a listagem no service**

Em `apps/api/src/admin/admin.service.ts`, na query de `produtos()` (linha 201), troque:

```typescript
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco,
```

por:

```typescript
      `select p.id, p.sku, p.nome, p.unidade_venda, p.ativo, p.desconto_qtd_minima, p.desconto_qtd_preco, p.data_validade,
```

Adicione o método novo logo depois de `descontoQtdProduto` (depois da linha 243, onde esse método termina com `}`):

```typescript
  async validadeProduto(id: string, dataValidade: string | null, usuarioId: string) {
    const { pool } = tenantCtx();
    const r = await pool.query(
      `update produtos set data_validade = $2 where id = $1 returning id`,
      [id, dataValidade],
    );
    if (!r.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json)
       values ($1,'editar_validade','produto',$2,$3)`,
      [usuarioId, id, JSON.stringify({ dataValidade })],
    );
    return { ok: true };
  }
```

- [ ] **Step 4: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

- [ ] **Step 5: Verificar manualmente com curl**

Login e pegue um produto real (`select id from produtos limit 1`), então:

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/produtos/<PRODUTO_ID>/validade \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"dataValidade":"2026-08-10"}'
```

Expected: `{"ok":true}`.

```bash
curl -s http://localhost:3000/v1/admin/produtos -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log(d.dados.find(p => p.data_validade));
"
```

Expected: mostra o produto com `data_validade` preenchida.

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/configuracoes \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"valores":{"dias_vencimento_proximo":30}}'
```

Expected: resposta inclui `"dias_vencimento_proximo":30`.

Limpe os valores de teste ao final:

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/produtos/<PRODUTO_ID>/validade \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
curl -s -X PATCH http://localhost:3000/v1/admin/configuracoes \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"valores":{"dias_vencimento_proximo":0}}'
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/admin/admin-config.controller.ts apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.service.ts
git commit -m "feat(api): endpoint admin pra editar validade do produto e chave de dias de vencimento"
```

---

### Task 3: API pública — vitrine "Vencimento Próximo" no `/v1/home`

**Files:**
- Modify: `apps/api/src/catalog/catalog.service.ts:15-17` (constante `SELECT_PRODUTO`)
- Modify: `apps/api/src/catalog/catalog.service.ts:67-191` (método `home`)

**Interfaces:**
- Consome: coluna `produtos.data_validade` (Task 1), chave `dias_vencimento_proximo` de `configuracoes` (Task 2).
- Produz: campo `data_validade` em todo produto retornado por `SELECT_PRODUTO` (consumido pela Task 5, selo no app); campo `vencimentoProximo` no JSON de `GET /v1/home` (consumido pela Task 5, vitrine no app).

- [ ] **Step 1: Expor `data_validade` no catálogo**

Em `apps/api/src/catalog/catalog.service.ts`, na constante `SELECT_PRODUTO` (linha 16-17), troque:

```typescript
  select p.id, p.sku, p.ean, p.nome, p.descricao, p.unidade_venda, p.qtd_por_embalagem,
         p.qtd_minima, p.desconto_qtd_minima, p.desconto_qtd_preco, m.nome as marca, c.nome as categoria, c.id as categoria_id,
```

por:

```typescript
  select p.id, p.sku, p.ean, p.nome, p.descricao, p.unidade_venda, p.qtd_por_embalagem,
         p.qtd_minima, p.desconto_qtd_minima, p.desconto_qtd_preco, p.data_validade, m.nome as marca, c.nome as categoria, c.id as categoria_id,
```

- [ ] **Step 2: Adicionar a consulta de vencimento próximo no `home()`**

No método `home()`, logo depois da linha `const tabela = await this.tabelaPrecoDe(clienteId);` (linha 69), adicione a leitura do limite de dias configurado (sequencial, igual `tabela` já é resolvido antes do `Promise.all`):

```typescript
    const diasCfg = await pool.query(
      `select valor_json from configuracoes where chave = 'dias_vencimento_proximo'`,
    );
    const diasVencimento = Number(diasCfg.rows[0]?.valor_json ?? 0);
```

Troque a linha 70 (a desestruturação do `Promise.all`):

```typescript
    const [banners, promocoes, maisVendidos, categoriasComProduto, patrocinadores] = await Promise.all([
```

por:

```typescript
    const [banners, promocoes, maisVendidos, categoriasComProduto, patrocinadores, vencimentoProximo] = await Promise.all([
```

E adicione a query nova como último elemento do array de `Promise.all` (logo depois do fechamento da query de `patrocinadores`, que termina em `[tabela],\n      ),` — antes do `]);` de fechamento do `Promise.all` na linha 117):

```typescript
      // Vencimento Próximo: produtos com validade cadastrada dentro do limite configurado
      // (dias_vencimento_proximo em configuracoes). 0/ausente = sem limite, sem vitrine.
      diasVencimento > 0
        ? pool.query(
            `${SELECT_PRODUTO} and p.data_validade is not null
               and p.data_validade between current_date and current_date + $2::int
              order by p.data_validade asc limit 10`,
            [tabela, diasVencimento],
          )
        : Promise.resolve({ rows: [] as unknown[] }),
```

- [ ] **Step 3: Retornar `vencimentoProximo` na resposta**

No `return` do método `home()` (linhas 185-190), troque:

```typescript
    return {
      banners: banners.rows,
      promocoes: promocoes.rows,
      maisVendidos: maisVendidos.rows,
      prateleiras: feed,
    };
```

por:

```typescript
    return {
      banners: banners.rows,
      promocoes: promocoes.rows,
      maisVendidos: maisVendidos.rows,
      vencimentoProximo: vencimentoProximo.rows,
      prateleiras: feed,
    };
```

- [ ] **Step 4: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

- [ ] **Step 5: Verificar manualmente com curl**

Configure um produto de teste com `data_validade` daqui a poucos dias e `dias_vencimento_proximo` maior que isso (Task 2's endpoints), então:

```bash
curl -s -H "X-Tenant: cahu" http://localhost:3000/v1/home | node -e "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  console.log('vencimentoProximo:', d.vencimentoProximo.length, d.vencimentoProximo.map(p=>p.nome+' ('+p.data_validade+')').join(', '));
"
```

Expected: o produto de teste aparece na lista.

Com `dias_vencimento_proximo` voltando pra `0` (limpeza da Task 2), confirme que `vencimentoProximo` volta a ser um array vazio:

```bash
curl -s -H "X-Tenant: cahu" http://localhost:3000/v1/home | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).vencimentoProximo.length)"
```

Expected: `0`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/catalog/catalog.service.ts
git commit -m "feat(api): vitrine vencimento proximo no /v1/home"
```

---

### Task 4: Retaguarda — campo de validade e limite de dias

**Files:**
- Modify: `apps/admin/src/paginas/Configuracoes.tsx`
- Modify: `apps/admin/src/paginas/Produtos.tsx`

**Interfaces:**
- Consome: `PATCH /admin/configuracoes` e `PATCH /admin/produtos/:id/validade` (Task 2), campo `data_validade` já retornado por `GET /admin/produtos` (Task 2).

- [ ] **Step 1: Campo de dias em Configurações**

Em `apps/admin/src/paginas/Configuracoes.tsx`, adicione `dias_vencimento_proximo?: number;` à interface `Config` (mesmo padrão de `limite_estoque_baixo`), e um card novo logo depois do card "Estoque baixo":

```tsx
        <div className="card">
          <div className="rotulo">Vencimento próximo</div>
          <input type="number" min="0" value={cfg.dias_vencimento_proximo ?? 0}
            onChange={(e) => setCfg({ ...cfg, dias_vencimento_proximo: Number(e.target.value) })}
            style={{ marginTop: 8, width: 160 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>0 = vitrine desativada. Produtos com validade cadastrada dentro desse número de dias aparecem na vitrine "Vencimento Próximo" do app.</div>
        </div>
```

- [ ] **Step 2: Campo de validade em Produtos**

Em `apps/admin/src/paginas/Produtos.tsx`, adicione `data_validade?: string;` à interface `LinhaProduto`, e os estados/funções e a coluna de tabela, seguindo exatamente o padrão já usado pra `desconto_qtd_minima`/`desconto_qtd_preco` no mesmo arquivo (estados `editandoId`/`minimaEdit`/`precoEdit` para desconto; adicione um estado irmão `validadeEdit` e funções `abrirEdicaoValidade`/`salvarValidade`/`removerValidade`, reaproveitando o MESMO `editandoId` — ou seja, quando `editandoId === p.id`, mostra os campos de desconto E o campo de validade juntos na mesma linha em edição, já que ambos usam a mesma coluna "controle de edição" hoje; a alternativa de ter dois `editandoId` separados criaria dois modos de edição por linha, o que é mais confuso — mantenha um único `editandoId` compartilhado).

Adicione os estados novos logo depois de `precoEdit`:

```tsx
  const [validadeEdit, setValidadeEdit] = useState('');
```

Atualize `abrirEdicaoDesconto` pra também preencher `validadeEdit` (troque a função inteira):

```tsx
  function abrirEdicaoDesconto(p: LinhaProduto) {
    setEditandoId(p.id);
    setMinimaEdit(p.desconto_qtd_minima != null ? String(p.desconto_qtd_minima) : '');
    setPrecoEdit(p.desconto_qtd_preco != null ? String(p.desconto_qtd_preco) : '');
    setValidadeEdit(p.data_validade ?? '');
  }
```

Adicione a função de salvar validade logo depois de `removerDesconto`:

```tsx
  async function salvarValidade(id: string) {
    try {
      await api(`/admin/produtos/${id}/validade`, {
        method: 'PATCH',
        body: JSON.stringify({ dataValidade: validadeEdit.trim() || undefined }),
      });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }
```

Adicione uma coluna nova na tabela (header e célula), logo depois da coluna "Desconto por quantidade" — no `<thead>`, troque:

```tsx
            <tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Situação</th><th></th></tr>
```

por:

```tsx
            <tr><th>SKU</th><th>Produto</th><th>Categoria</th><th>Un.</th><th>Estoque</th><th>Preço</th><th>Desconto por quantidade</th><th>Validade</th><th>Situação</th><th></th></tr>
```

E adicione a célula nova logo depois do `</td>` que fecha a célula de desconto (a que tem o `editandoId === p.id ? (...)` para desconto), como uma nova `<td>` própria:

```tsx
                <td>
                  {editandoId === p.id ? (
                    <div className="filtros" style={{ flexWrap: 'nowrap' }}>
                      <input type="date" value={validadeEdit}
                        onChange={(e) => setValidadeEdit(e.target.value)} style={{ width: 150 }} />
                      <button className="btn-mini btn-ok" onClick={() => salvarValidade(p.id)}>Salvar</button>
                    </div>
                  ) : p.data_validade ? (
                    <span>{new Date(p.data_validade).toLocaleDateString('pt-BR')}</span>
                  ) : (
                    <span style={{ color: 'var(--texto-2)' }}>—</span>
                  )}
                </td>
```

Atualize o `colSpan` da linha "Nenhum produto" (hoje `colSpan={9}`) pra `colSpan={10}`, já que uma coluna nova foi adicionada.

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

Abra `http://localhost:5173/configuracoes`, preencha "Vencimento próximo" com `30`, salve. Abra `http://localhost:5173/produtos`, clique em "Editar"/"+ Adicionar" (o mesmo botão de edição do desconto) num produto, preencha uma data no campo "Validade" novo, clique "Salvar" — confirme que a coluna "Validade" passa a mostrar a data formatada (dd/mm/aaaa).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/paginas/Configuracoes.tsx apps/admin/src/paginas/Produtos.tsx
git commit -m "feat(admin): campo de validade do produto e limite de dias de vencimento proximo"
```

---

### Task 5: App Flutter — vitrine e selo de vencimento próximo

**Files:**
- Modify: `apps/mobile/lib/features/home/home_screen.dart`
- Modify: `apps/mobile/lib/widgets/produto_card.dart`

**Interfaces:**
- Consome: `_home!['vencimentoProximo']` (Task 3), campo `data_validade` em `produto` (Task 3).

- [ ] **Step 1: Adicionar a vitrine na Home**

Em `apps/mobile/lib/features/home/home_screen.dart`, no método `build`, dentro do `ListView` que já lista `_banners()`, a vitrine de "Promoções" e a de "Mais vendidos" (procure pelo trecho `_vitrine('Mais vendidos', _home!['maisVendidos'] as List? ?? const [])`), adicione logo depois:

```dart
                      _vitrine('Vencimento Próximo',
                          _home!['vencimentoProximo'] as List? ?? const []),
```

Também atualize a condição do estado vazio (o bloco que verifica `if ((_home!['promocoes'] as List? ?? []).isEmpty && (_home!['maisVendidos'] as List? ?? []).isEmpty && (_home!['prateleiras'] as List? ?? []).isEmpty)`) pra incluir `vencimentoProximo` na checagem, trocando essa condição por:

```dart
                      if ((_home!['promocoes'] as List? ?? []).isEmpty &&
                          (_home!['maisVendidos'] as List? ?? []).isEmpty &&
                          (_home!['vencimentoProximo'] as List? ?? []).isEmpty &&
                          (_home!['prateleiras'] as List? ?? []).isEmpty)
```

- [ ] **Step 2: Selo no card do produto**

Em `apps/mobile/lib/widgets/produto_card.dart`, no método estático `_blocoPreco`, adicione a leitura do campo novo junto das outras (perto de `descontoQtdMinima`/`descontoQtdPreco`):

```dart
    final dataValidade = produto['data_validade'] as String?;
```

E adicione o selo como mais um filho do `Column` retornado, logo depois do bloco `if (descontoQtdMinima != null && descontoQtdPreco != null)` já existente:

```dart
        if (dataValidade != null)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                'Val. ${_formatarData(dataValidade)}',
                style: TextStyle(
                    fontSize: 10.5, fontWeight: FontWeight.w700, color: Colors.red.shade700),
              ),
            ),
          ),
```

Adicione o método auxiliar de formatação de data logo depois do método `_unidade` (na classe `ProdutoCard`):

```dart
  static String _formatarData(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  }
```

- [ ] **Step 3: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 4: Rodar e verificar visualmente**

Com um produto de teste tendo `data_validade` configurada (Task 2/4, uma data dentro dos próximos `dias_vencimento_proximo` dias) e a configuração de dias ativa, rode o app (`flutter run`) e confirme: a vitrine "Vencimento Próximo" aparece na Home com esse produto; o card dele mostra o selo vermelho "Val. DD/MM"; produtos sem validade configurada não mostram o selo nem entram na vitrine.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/features/home/home_screen.dart apps/mobile/lib/widgets/produto_card.dart
git commit -m "feat(mobile): vitrine e selo de vencimento proximo"
```

---

## Verificação final (fim a fim)

1. Com `dias_vencimento_proximo = 0` (ou ausente): nenhuma vitrine nova aparece, nenhum selo — comportamento idêntico a antes da feature.
2. Configurando um limite de dias e uma validade de teste dentro da janela, a vitrine "Vencimento Próximo" aparece na Home e o selo "Val. DD/MM" aparece no card.
3. Produto com validade fora da janela (ou sem validade) não aparece na vitrine nem mostra selo.
