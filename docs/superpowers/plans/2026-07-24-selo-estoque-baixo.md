# Selo de Estoque Baixo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar um selo "{N} em estoque" no card do produto quando o estoque estiver baixo (limite configurável globalmente pela retaguarda), incentivando decisão de compra mais rápida (benchmark Praso).

**Architecture:** Reaproveita 100% a infraestrutura de configuração já existente (`configuracoes` key-value já usada por `pedido_minimo` etc.) — sem migração de banco, sem endpoint novo, sem chamada de rede nova no app (o app já carrega todas as configurações no boot via `TenantTheme.instance.configuracoes`).

**Tech Stack:** NestJS 10, PostgreSQL (SQL cru via `tenantCtx().pool`), React 18 + Vite, Flutter/Dart.

## Global Constraints

- Limite configurado globalmente (não por produto) — confirmado com o Tiago.
- Valor `0` ou ausente = selo desativado (nunca aparece).
- Produto com `estoque == 0` continua mostrando "Sem estoque" (comportamento já existente) — o selo de urgência só aparece quando `0 < estoque <= limite`.
- Este projeto não usa testes automatizados de backend/mobile para os CRUDs/telas equivalentes — verificação estabelecida é manual: `curl` pra API, Chrome pra retaguarda, `flutter analyze` + rodar no dispositivo pro app.
- Cor/estilo do selo é placeholder (laranja) — o Tiago vai ajustar depois de ver rodando; não é bloqueante pra esta implementação.

---

### Task 1: Backend admin — liberar a chave de configuração

**Files:**
- Modify: `apps/api/src/admin/admin-config.controller.ts:41`

**Interfaces:**
- Produz: chave `limite_estoque_baixo` aceita por `GET/PATCH /admin/configuracoes` (endpoints já existentes, sem mudança de assinatura), consumida pela Task 2 (retaguarda) e exposta automaticamente em `GET /v1/config` (Task 3, app).

- [ ] **Step 1: Adicionar a chave à whitelist**

Em `apps/api/src/admin/admin-config.controller.ts`, troque a linha 41:

```typescript
const CHAVES_PERMITIDAS = ['pedido_minimo', 'formas_pagamento', 'aprovacao_cadastro', 'horario_atendimento'];
```

por:

```typescript
const CHAVES_PERMITIDAS = ['pedido_minimo', 'formas_pagamento', 'aprovacao_cadastro', 'horario_atendimento', 'limite_estoque_baixo'];
```

- [ ] **Step 2: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: log de inicialização sem erro.

- [ ] **Step 3: Verificar manualmente com curl**

Login (`admin@cahu.com.br` / `cahu@2026`, `POST /v1/admin/auth/login`, header `X-Tenant: cahu`), depois:

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/configuracoes \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"valores":{"limite_estoque_baixo":5}}'
```

Expected: resposta JSON inclui `"limite_estoque_baixo":5`.

```bash
curl -s -H "X-Tenant: cahu" http://localhost:3000/v1/config
```

Expected: `configuracoes.limite_estoque_baixo` é `5`.

Remova o valor de teste ao final:

```bash
curl -s -X PATCH http://localhost:3000/v1/admin/configuracoes \
  -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"valores":{"limite_estoque_baixo":0}}'
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/admin/admin-config.controller.ts
git commit -m "feat(api): libera chave limite_estoque_baixo nas configuracoes"
```

---

### Task 2: Retaguarda — card "Estoque baixo" na tela Configurações

**Files:**
- Modify: `apps/admin/src/paginas/Configuracoes.tsx`

**Interfaces:**
- Consome: `PATCH /admin/configuracoes` (Task 1) via `api()` já existente.

- [ ] **Step 1: Atualizar a interface `Config`**

Em `apps/admin/src/paginas/Configuracoes.tsx`, troque a interface (linhas 4-9):

```tsx
interface Config {
  pedido_minimo?: { tipo: string; valor: number };
  formas_pagamento?: string[];
  aprovacao_cadastro?: boolean;
  horario_atendimento?: Record<string, string>;
}
```

por:

```tsx
interface Config {
  pedido_minimo?: { tipo: string; valor: number };
  formas_pagamento?: string[];
  aprovacao_cadastro?: boolean;
  horario_atendimento?: Record<string, string>;
  limite_estoque_baixo?: number;
}
```

- [ ] **Step 2: Adicionar o card**

Na mesma tela, logo depois do card "Pedido mínimo" (depois da linha 52, `</div>` que fecha esse card), adicione:

```tsx
        <div className="card">
          <div className="rotulo">Estoque baixo</div>
          <input type="number" min="0" value={cfg.limite_estoque_baixo ?? 0}
            onChange={(e) => setCfg({ ...cfg, limite_estoque_baixo: Number(e.target.value) })}
            style={{ marginTop: 8, width: 160 }} />
          <div style={{ color: 'var(--texto-2)', marginTop: 6 }}>0 = selo desativado. Produtos com estoque igual ou menor que esse número mostram "X em estoque" no app.</div>
        </div>
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

Abra `http://localhost:5173/configuracoes`, logado. Preencha "Estoque baixo" com `5`, clique "Salvar configurações", confirme "✓ Salvo". Recarregue a página e confirme que o valor `5` persiste no campo.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/paginas/Configuracoes.tsx
git commit -m "feat(admin): campo de limite de estoque baixo na tela Configuracoes"
```

---

### Task 3: App Flutter — selo "{N} em estoque" no card do produto

**Files:**
- Modify: `apps/mobile/lib/widgets/produto_card.dart`

**Interfaces:**
- Consome: `TenantTheme.instance.configuracoes['limite_estoque_baixo']` (já carregado no boot pelo `tenant_theme.dart:33`, alimentado pela Task 1/2 via `GET /v1/config`), campo `produto['estoque']` (já existente em todo produto retornado pela API).

- [ ] **Step 1: Adicionar o import**

Em `apps/mobile/lib/widgets/produto_card.dart`, no topo do arquivo (depois da linha 4, `import '../features/catalog/produto_screen.dart';`), adicione:

```dart
import '../core/tenant_theme.dart';
```

- [ ] **Step 2: Adicionar o selo no `Stack` da imagem**

No método `build` da classe `ProdutoCard`, dentro do `Stack` que já existe (contém o `AspectRatio` da imagem e o selo `if (emPromocao) Positioned(...)` do "OFERTA"), adicione um novo `Positioned` como último filho da lista `children` do `Stack`:

```dart
                  if (_estoqueBaixo(produto))
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade700,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text('${asDouble(produto['estoque']).toInt()} em estoque',
                            style: const TextStyle(
                                color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
                      ),
                    ),
```

- [ ] **Step 3: Adicionar o método auxiliar**

Na classe `ProdutoCard`, logo depois do método estático `_unidade` (o que formata `"$un c/ ${porEmb.toInt()}"`), adicione:

```dart
  static bool _estoqueBaixo(Map<String, dynamic> produto) {
    final estoque = asDouble(produto['estoque']);
    final limite = asDouble(TenantTheme.instance.configuracoes['limite_estoque_baixo']);
    return estoque > 0 && limite > 0 && estoque <= limite;
  }
```

- [ ] **Step 4: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 5: Rodar e verificar visualmente**

Com `limite_estoque_baixo` configurado (Task 1/2, ex.: `5`) e um produto de teste com estoque entre 1 e 5 (ajuste via `update estoques set quantidade = 3 where produto_id = '<id>'` no banco de dev, ou pela retaguarda se houver tela de estoque), rode o app (`flutter run`) e confirme: o card desse produto mostra o selo laranja "3 em estoque" no canto superior direito da imagem; um produto com estoque acima do limite não mostra nada; um produto com estoque `0` continua mostrando "Sem estoque" (sem o selo novo). Desfaça a alteração de estoque de teste ao final.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/widgets/produto_card.dart
git commit -m "feat(mobile): selo de estoque baixo no card do produto"
```

---

## Verificação final (fim a fim)

1. Com `limite_estoque_baixo = 0` (ou ausente): nenhum produto mostra o selo — comportamento idêntico a antes da feature.
2. Configurando um limite > 0 pela retaguarda, produtos com estoque dentro da faixa mostram o selo no app; produtos com estoque acima do limite ou igual a zero não mostram.
3. Nenhuma chamada de rede nova no app (o selo usa dados já carregados no boot e no card do produto).
