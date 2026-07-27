# Card Estilo Praso + Favoritos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesenhar o `ProdutoCard` (usado em toda vitrine/grade do app) pro visual do concorrente Praso — preço preto/verde com "%OFF" inline, selo de embalagem e botão "+" sobrepostos na foto — e adicionar favoritar produto (coração), salvo no servidor por cliente.

**Architecture:** Tabela nova `favoritos` (cliente_id, produto_id) só no banco do tenant. Backend reaproveita `ProfileController` existente (mesmo padrão SQL cru de endereços/dispositivos, sem service separado). App ganha `FavoritosStore` (singleton `ChangeNotifier`, espelho exato de `CarrinhoStore`) e o `ProdutoCard` é reescrito por completo — sem `Card`/sombra, `Stack` na foto com coração + selo de embalagem + botão "+", bloco de preço abaixo com nova lógica de cor/percentual.

**Tech Stack:** NestJS 10, PostgreSQL (SQL cru via `tenantCtx().pool`), Flutter/Dart.

## Global Constraints

- Cor do preço: preto (`Colors.black87`) por padrão; verde (`Colors.green.shade700`) quando em promoção, com selo "X% OFF" verde na mesma linha do preço riscado — confirmado com o Tiago.
- Selo de validade continua vermelho; botão "+" continua amarelo (cor do tenant, já vem do `ColorScheme`), só muda de posição pra cima da foto.
- Favoritos são salvos no servidor por cliente (não local) — sincronizam entre dispositivos. Visitante nunca tem favoritos; tocar o coração como visitante abre o gate de login/cadastro (mesmo padrão do checkout, `EntrarOuCriarScreen`).
- Fora de escopo (não implementar): tela dedicada "Meus favoritos", sincronizar favoritos de visitante pra conta ao logar.
- Este projeto não usa testes automatizados de backend/mobile — verificação estabelecida é manual: `curl` pra API, `flutter analyze` + rodar no dispositivo/emulador pro app. Ajuste fino de altura/overflow do card é esperado numa 2ª rodada depois que o Tiago testar no celular dele (mesmo padrão das últimas 3 features de card) — não é bloqueante pra esta implementação.
- Migração de banco vai em `infra/sql/tenant` (versionado no repo) **e** espelhada em `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant` (pasta de documentação fora do repo, mesma convenção das migrações 001-009) — os dois arquivos devem ter conteúdo idêntico.
- Senha do Postgres de dev: `postgres` (via `$env:PGPASSWORD`, host `localhost`, porta `5432`, usuário `postgres`). Banco do tenant CAHU em dev: `fluxo_t_cahu`.

---

### Task 1: Migração — tabela `favoritos`

**Files:**
- Create: `infra/sql/tenant/010_favoritos.sql`
- Create: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\010_favoritos.sql` (conteúdo idêntico ao acima)

**Interfaces:**
- Produz: tabela `favoritos(cliente_id uuid, produto_id uuid, criado_em timestamptz)`, PK composta `(cliente_id, produto_id)` — consumida pela Task 2.

- [ ] **Step 1: Criar a migração**

Crie `infra/sql/tenant/010_favoritos.sql`:

```sql
-- Favoritos (benchmark Praso, 24/07/2026): cliente favorita produto, salvo no
-- servidor (não local) para sincronizar entre dispositivos.
create table if not exists favoritos (
  cliente_id uuid not null references clientes(id),
  produto_id uuid not null references produtos(id),
  criado_em timestamptz not null default now(),
  primary key (cliente_id, produto_id)
);

insert into schema_migrations (versao) values ('010') on conflict do nothing;
```

- [ ] **Step 2: Espelhar em `11 - SQL`**

Copie o mesmo conteúdo pra `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\010_favoritos.sql`.

- [ ] **Step 3: Aplicar no banco de dev**

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -f infra/sql/tenant/010_favoritos.sql
```

Expected: `CREATE TABLE` (ou nada, se `if not exists` já existir) seguido de `INSERT 0 1`.

- [ ] **Step 4: Verificar a tabela**

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "\d favoritos"
```

Expected: mostra as 3 colunas (`cliente_id`, `produto_id`, `criado_em`) e a PK composta.

- [ ] **Step 5: Commit**

```bash
git add infra/sql/tenant/010_favoritos.sql
git commit -m "feat(db): tabela favoritos (cliente favorita produto)"
```

---

### Task 2: Backend — endpoints de favoritos

**Files:**
- Modify: `apps/api/src/profile/profile.controller.ts`

**Interfaces:**
- Consome: tabela `favoritos` (Task 1), `tenantCtx()`, `ReqCliente`/`JwtAuthGuard` (já importados no arquivo).
- Produz: `GET /v1/favoritos` → `string[]` (ids de produto); `POST /v1/favoritos/:produtoId` → `{ok:true}`; `DELETE /v1/favoritos/:produtoId` → `{ok:true}` — consumidos pela Task 3 (`FavoritosStore`).

- [ ] **Step 1: Adicionar os 3 endpoints**

Em `apps/api/src/profile/profile.controller.ts`, logo antes do fechamento da classe `ProfileController` (depois do método `notificacoes`, antes do `}` final na linha 169), adicione:

```typescript

  @Get('favoritos')
  async favoritos(@Req() req: ReqCliente) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select produto_id from favoritos where cliente_id = $1`,
      [req.cliente.clienteId],
    );
    return rows.map((r) => r.produto_id);
  }

  @Post('favoritos/:produtoId')
  async favoritar(@Req() req: ReqCliente, @Param('produtoId', ParseUUIDPipe) produtoId: string) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into favoritos (cliente_id, produto_id) values ($1,$2) on conflict do nothing`,
      [req.cliente.clienteId, produtoId],
    );
    return { ok: true };
  }

  @Delete('favoritos/:produtoId')
  async desfavoritar(@Req() req: ReqCliente, @Param('produtoId', ParseUUIDPipe) produtoId: string) {
    const { pool } = tenantCtx();
    await pool.query(
      `delete from favoritos where cliente_id = $1 and produto_id = $2`,
      [req.cliente.clienteId, produtoId],
    );
    return { ok: true };
  }
```

- [ ] **Step 2: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: log de inicialização sem erro (`Nest application successfully started` ou equivalente).

- [ ] **Step 3: Verificar manualmente com curl**

Em outro terminal, registre um cliente de teste (auto-loga, devolve tokens):

```bash
curl -s -X POST http://localhost:3000/v1/auth/registrar \
  -H "X-Tenant: cahu" -H "Content-Type: application/json" \
  -d '{"tipo":"CPF","documento":"11122233396","nomeFantasia":"Teste Favoritos","email":"teste.favoritos@example.com","senha":"teste123"}'
```

Expected: JSON com `accessToken`. Guarde em `$TOKEN`.

Pegue um produto real do seed:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -tAc "select id from produtos limit 1"
```

Guarde em `$PRODUTO_ID`. Agora o ciclo completo:

```bash
curl -s http://localhost:3000/v1/favoritos -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `[]`

```bash
curl -s -X POST "http://localhost:3000/v1/favoritos/$PRODUTO_ID" -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"ok":true}`

```bash
curl -s http://localhost:3000/v1/favoritos -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `["<PRODUTO_ID>"]`

```bash
curl -s -X DELETE "http://localhost:3000/v1/favoritos/$PRODUTO_ID" -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `{"ok":true}`

```bash
curl -s http://localhost:3000/v1/favoritos -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```

Expected: `[]`

Limpe o cliente de teste:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "delete from clientes where email='teste.favoritos@example.com'"
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/profile/profile.controller.ts
git commit -m "feat(api): endpoints de favoritos (GET/POST/DELETE)"
```

---

### Task 3: App Flutter — `FavoritosStore` + boot/logout

**Files:**
- Create: `apps/mobile/lib/core/favoritos_store.dart`
- Modify: `apps/mobile/lib/features/shell/home_shell.dart`
- Modify: `apps/mobile/lib/features/profile/perfil_screen.dart`

**Interfaces:**
- Consome: `ApiClient.instance.get/post/delete` e `ApiClient.instance.logado` (`apps/mobile/lib/core/api_client.dart`, já existente).
- Produz: `FavoritosStore.instance` — `Set<String> favoritados`, `bool favoritado(String produtoId)`, `Future<void> carregar()`, `Future<void> alternar(String produtoId)`, `void limpar()` — consumidos pela Task 4 (`ProdutoCard`).

- [ ] **Step 1: Criar `FavoritosStore`**

Crie `apps/mobile/lib/core/favoritos_store.dart`:

```dart
import 'package:flutter/foundation.dart';

import 'api_client.dart';

/// Estado global dos favoritos do cliente logado, espelho de GET /favoritos.
/// Salvo no servidor (não local) para sincronizar entre dispositivos.
/// Visitante nunca tem favoritos — fica com o Set vazio até logar.
class FavoritosStore extends ChangeNotifier {
  FavoritosStore._();
  static final FavoritosStore instance = FavoritosStore._();

  Set<String> favoritados = {};

  bool favoritado(String produtoId) => favoritados.contains(produtoId);

  Future<void> carregar() async {
    if (!ApiClient.instance.logado) {
      favoritados = {};
      notifyListeners();
      return;
    }
    try {
      final r = await ApiClient.instance.get('/favoritos') as List;
      favoritados = r.map((e) => e as String).toSet();
    } catch (_) {
      // Sem conexão no boot: mantém o estado atual em vez de derrubar o app.
    }
    notifyListeners();
  }

  /// Chama a API primeiro (fonte da verdade), só então atualiza o estado local.
  Future<void> alternar(String produtoId) async {
    if (favoritados.contains(produtoId)) {
      await ApiClient.instance.delete('/favoritos/$produtoId');
      favoritados.remove(produtoId);
    } else {
      await ApiClient.instance.post('/favoritos/$produtoId');
      favoritados.add(produtoId);
    }
    notifyListeners();
  }

  /// Após logout — não chama a API.
  void limpar() {
    favoritados = {};
    notifyListeners();
  }
}
```

- [ ] **Step 2: Analisar**

```bash
cd apps/mobile
flutter analyze lib/core/favoritos_store.dart
```

Expected: `No issues found!`.

- [ ] **Step 3: Carregar no boot da casca autenticada**

Em `apps/mobile/lib/features/shell/home_shell.dart`, adicione o import (depois da linha 3, `import '../../core/carrinho_store.dart';`):

```dart
import '../../core/favoritos_store.dart';
```

E no `initState` (linha 24-27), troque:

```dart
  @override
  void initState() {
    super.initState();
    CarrinhoStore.instance.carregar();
  }
```

por:

```dart
  @override
  void initState() {
    super.initState();
    CarrinhoStore.instance.carregar();
    FavoritosStore.instance.carregar();
  }
```

- [ ] **Step 4: Limpar no logout**

Em `apps/mobile/lib/features/profile/perfil_screen.dart`, adicione o import (depois da linha 4, `import '../../core/carrinho_store.dart';`):

```dart
import '../../core/favoritos_store.dart';
```

E no método `_sair()` (linhas 71-76), troque:

```dart
    if (confirmar != true || !mounted) return;
    await ApiClient.instance.sair();
    CarrinhoStore.instance.limpar();
    await CarrinhoStore.instance.carregar(); // carrinho novo do device
    if (mounted) setState(() {});
```

por:

```dart
    if (confirmar != true || !mounted) return;
    await ApiClient.instance.sair();
    CarrinhoStore.instance.limpar();
    await CarrinhoStore.instance.carregar(); // carrinho novo do device
    FavoritosStore.instance.limpar();
    if (mounted) setState(() {});
```

- [ ] **Step 5: Analisar o app inteiro**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/core/favoritos_store.dart apps/mobile/lib/features/shell/home_shell.dart apps/mobile/lib/features/profile/perfil_screen.dart
git commit -m "feat(mobile): FavoritosStore, carregado no boot e limpo no logout"
```

---

### Task 4: App Flutter — `ProdutoCard` redesenhado + coração

**Files:**
- Modify: `apps/mobile/lib/widgets/produto_card.dart`

**Interfaces:**
- Consome: `FavoritosStore.instance` (Task 3), `ApiClient.instance.logado` (`core/api_client.dart`), `EntrarOuCriarScreen` (`features/auth/entrar_ou_criar_screen.dart`, já existente), `produto['preco_tabela']` e `produto['preco']` (já vêm da API, `catalog.service.ts:16-23`).
- Mantém a mesma assinatura pública `ProdutoCard({produto, largura})` — nenhuma chamada existente em `home_screen.dart`, `vitrine_patrocinada.dart` ou `produtos_screen.dart` precisa mudar.

- [ ] **Step 1: Reescrever o arquivo completo**

Substitua todo o conteúdo de `apps/mobile/lib/widgets/produto_card.dart` por:

```dart
import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../core/carrinho_store.dart';
import '../core/favoritos_store.dart';
import '../core/formatadores.dart';
import '../core/tenant_theme.dart';
import '../features/auth/entrar_ou_criar_screen.dart';
import '../features/catalog/produto_screen.dart';

/// Card de produto usado nas vitrines da Home (largura fixa) e nas grades
/// de categoria/busca (largura fluida). Preço já vem resolvido pela API
/// (promoção vigente vence a tabela do cliente). Visual estilo Praso: sem
/// moldura de Card, coração/selo de embalagem/botão "+" sobrepostos na foto.
class ProdutoCard extends StatelessWidget {
  const ProdutoCard({super.key, required this.produto, this.largura});

  final Map<String, dynamic> produto;
  final double? largura;

  @override
  Widget build(BuildContext context) {
    final imagens = produto['imagens'] as List?;
    final imagemUrl = (imagens != null && imagens.isNotEmpty) ? imagens.first['url'] as String? : null;
    final emPromocao = produto['preco_promocional'] != null;
    final semEstoque = asDouble(produto['estoque']) <= 0;
    final produtoId = produto['id'] as String;

    return SizedBox(
      width: largura,
      child: Container(
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ProdutoScreen(produtoId: produtoId)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 1.0,
                    child: imagemUrl != null
                        ? Image.network(imagemUrl, fit: BoxFit.cover,
                            errorBuilder: (_, e, s) => _semFoto())
                        : _semFoto(),
                  ),
                  Positioned(top: 8, right: 8, child: _BotaoFavorito(produtoId: produtoId)),
                  Positioned(
                    bottom: 8,
                    left: 8,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(_unidade(produto),
                          style: TextStyle(
                              fontSize: 10.5, fontWeight: FontWeight.w700, color: Colors.grey.shade700)),
                    ),
                  ),
                  if (!semEstoque)
                    Positioned(bottom: 8, right: 8, child: _BotaoAdicionar(produto: produto)),
                ],
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      semEstoque
                          ? const Text('Sem estoque',
                              style: TextStyle(
                                  fontSize: 13, fontWeight: FontWeight.w800, color: Colors.grey))
                          : _blocoPreco(produto, emPromocao),
                      const SizedBox(height: 4),
                      Text(
                        produto['nome'] ?? '',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.2),
                      ),
                      _blocoSelos(produto),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _unidade(Map<String, dynamic> p) {
    final un = p['unidade_venda'] ?? 'UN';
    final porEmb = asDouble(p['qtd_por_embalagem']);
    return porEmb > 1 ? '$un c/ ${porEmb.toInt()}' : '$un';
  }

  static String _formatarData(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  }

  static bool _estoqueBaixo(Map<String, dynamic> produto) {
    final estoque = asDouble(produto['estoque']);
    final limite = asDouble(TenantTheme.instance.configuracoes['limite_estoque_baixo']);
    return estoque > 0 && limite > 0 && estoque <= limite;
  }

  /// Linha do preço: preto normal, ou verde + "X% OFF" + tabela riscada quando
  /// em promoção — igual ao Praso. Preço do pacote/caixa (quando vendido em
  /// fardo/caixa) logo abaixo, em texto cinza simples (sem fundo colorido).
  static Widget _blocoPreco(Map<String, dynamic> produto, bool emPromocao) {
    final porEmb = asDouble(produto['qtd_por_embalagem']);
    final sigla = siglaUnidade(produto);
    final unit = precoUnitario(produto);
    final precoAtual = asDouble(produto['preco']);
    final precoTabela = asDouble(produto['preco_tabela']);
    final percentual = emPromocao && precoTabela > 0
        ? ((precoTabela - precoAtual) / precoTabela * 100).round()
        : 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text('${moeda(unit)} /un',
                maxLines: 1,
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: emPromocao ? Colors.green.shade700 : Colors.black87)),
            if (emPromocao) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                decoration: BoxDecoration(
                  color: Colors.green.shade600,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('$percentual% OFF',
                    style: const TextStyle(
                        color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
              ),
              Text(
                moeda(precoUnitario(produto, campoPreco: 'preco_tabela')),
                style: TextStyle(
                  fontSize: 11,
                  color: Colors.grey.shade500,
                  decoration: TextDecoration.lineThrough,
                ),
              ),
            ],
          ],
        ),
        if (porEmb > 1)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text('$sigla c/${porEmb.toInt()} ${moeda(produto['preco'])}',
                style: TextStyle(fontSize: 10.5, color: Colors.grey.shade600)),
          ),
      ],
    );
  }

  /// Selos empilhados abaixo do nome: desconto por quantidade, estoque baixo,
  /// validade próxima — mantidos do design anterior.
  static Widget _blocoSelos(Map<String, dynamic> produto) {
    final descontoQtdMinima = produto['desconto_qtd_minima'] as int?;
    final descontoQtdPreco = produto['desconto_qtd_preco'];
    final dataValidade = produto['data_validade'] as String?;
    final selos = <Widget>[];
    if (descontoQtdMinima != null && descontoQtdPreco != null) {
      selos.add(_selo('a partir de $descontoQtdMinima un: ${moeda(descontoQtdPreco)}',
          Colors.green.shade50, Colors.green.shade800));
    }
    if (_estoqueBaixo(produto)) {
      selos.add(_selo('${asDouble(produto['estoque']).toInt()} em estoque',
          Colors.orange.shade50, Colors.orange.shade800));
    }
    if (dataValidade != null) {
      selos.add(_selo('Val. ${_formatarData(dataValidade)}', Colors.red.shade50, Colors.red.shade700));
    }
    if (selos.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: selos);
  }

  static Widget _selo(String texto, Color fundo, Color cor) {
    return Padding(
      padding: const EdgeInsets.only(top: 3),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(color: fundo, borderRadius: BorderRadius.circular(6)),
        child: Text(texto, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: cor)),
      ),
    );
  }

  Widget _semFoto() => Container(
        color: Colors.grey.shade100,
        child: Icon(Icons.inventory_2_outlined, size: 40, color: Colors.grey.shade400),
      );
}

/// Coração de favoritar: contorno se não favoritado, preenchido/vermelho se
/// favoritado. Visitante que toca é levado ao gate de login/cadastro (mesmo
/// padrão do checkout, `EntrarOuCriarScreen`) antes de favoritar.
class _BotaoFavorito extends StatefulWidget {
  const _BotaoFavorito({required this.produtoId});
  final String produtoId;

  @override
  State<_BotaoFavorito> createState() => _BotaoFavoritoState();
}

class _BotaoFavoritoState extends State<_BotaoFavorito> {
  bool _enviando = false;

  Future<void> _tocar(BuildContext context) async {
    if (_enviando) return;
    if (!ApiClient.instance.logado) {
      final ok = await Navigator.of(context)
          .push<bool>(MaterialPageRoute(builder: (_) => const EntrarOuCriarScreen()));
      if (ok != true || !context.mounted) return;
    }
    setState(() => _enviando = true);
    try {
      await FavoritosStore.instance.alternar(widget.produtoId);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: FavoritosStore.instance,
      builder: (context, _) {
        final ativo = FavoritosStore.instance.favoritado(widget.produtoId);
        return InkWell(
          onTap: () => _tocar(context),
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(6),
            decoration: const BoxDecoration(color: Colors.white70, shape: BoxShape.circle),
            child: _enviando
                ? const SizedBox(
                    width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : Icon(
                    ativo ? Icons.favorite : Icons.favorite_border,
                    size: 18,
                    color: ativo ? Colors.red.shade600 : Colors.grey.shade700,
                  ),
          ),
        );
      },
    );
  }
}

/// Adição rápida no card: "+" quando o item não está no carrinho; quando já
/// está, vira um mini stepper "− qtd +" (menos abaixo da qtd mínima remove).
class _BotaoAdicionar extends StatefulWidget {
  const _BotaoAdicionar({required this.produto});
  final Map<String, dynamic> produto;

  @override
  State<_BotaoAdicionar> createState() => _BotaoAdicionarState();
}

class _BotaoAdicionarState extends State<_BotaoAdicionar> {
  bool _enviando = false;

  Future<void> _mudar(double delta) async {
    if (_enviando) return;
    final store = CarrinhoStore.instance;
    final id = widget.produto['id'] as String;
    final minima = asDouble(widget.produto['qtd_minima']);
    final min = minima > 1 ? minima : 1.0;
    final atual = store.quantidadeDe(id);
    double nova;
    if (atual <= 0) {
      nova = min;
    } else {
      nova = atual + delta;
      if (nova < min) nova = 0; // abaixo do mínimo remove do carrinho
    }
    setState(() => _enviando = true);
    try {
      await store.definirQuantidade(id, nova);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListenableBuilder(
      listenable: CarrinhoStore.instance,
      builder: (context, _) {
        final qtd = CarrinhoStore.instance.quantidadeDe(widget.produto['id'] as String);
        if (qtd <= 0) {
          return SizedBox(
            height: 32,
            child: FilledButton(
              style: FilledButton.styleFrom(
                minimumSize: const Size(32, 32),
                padding: EdgeInsets.zero,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                backgroundColor: scheme.primary,
              ),
              onPressed: _enviando ? null : () => _mudar(1),
              child: _enviando
                  ? SizedBox(
                      width: 14, height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: scheme.onPrimary))
                  : const Icon(Icons.add, size: 18),
            ),
          );
        }
        Widget acao(IconData icone, double delta) => InkWell(
              onTap: _enviando ? null : () => _mudar(delta),
              borderRadius: BorderRadius.circular(10),
              child: SizedBox(
                width: 26,
                height: 32,
                child: Icon(icone, size: 15, color: scheme.onPrimary),
              ),
            );
        return Container(
          height: 32,
          decoration: BoxDecoration(
            color: scheme.primary,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              acao(Icons.remove, -1),
              _enviando
                  ? SizedBox(
                      width: 14, height: 14,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: scheme.onPrimary))
                  : Text(qtd % 1 == 0 ? qtd.toInt().toString() : '$qtd',
                      style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w800,
                          color: scheme.onPrimary)),
              acao(Icons.add, 1),
            ],
          ),
        );
      },
    );
  }
}
```

- [ ] **Step 2: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 3: Rodar e verificar visualmente**

Com a API rodando (Task 2) e um cliente de teste logado no app:

```bash
flutter run
```

Confirme na Home/Categorias/busca: coração no canto superior direito da foto (contorno cinza); tocar favorita (vira vermelho preenchido) e desfavorita de volta; visitante que toca é levado à tela "Quase lá!"; selo branco de embalagem no canto inferior esquerdo da foto (ex. "CX c/ 12"); botão "+" no canto inferior direito da foto; preço preto normal em produto sem promoção; preço verde + selo "X% OFF" + preço riscado em produto com promoção (use o produto "Absorvente Higiênico" de teste em produção, ou configure uma promoção em dev); nenhum `BOTTOM OVERFLOWED` no console — se aparecer, é o ajuste de altura esperado pra 2ª rodada (ver Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/widgets/produto_card.dart
git commit -m "feat(mobile): redesenho do ProdutoCard estilo Praso + favoritar"
```

---

### Task 5: Gerar APK pro Tiago testar no celular

**Files:** nenhum (build only)

- [ ] **Step 1: Descobrir o IP atual do notebook na rede**

```bash
ipconfig | grep -A2 "Wireless LAN adapter Wi-Fi"
```

Anote o `IPv4 Address` (muda por DHCP — confirme antes de buildar, mesma pegadinha já documentada nesta sessão).

- [ ] **Step 2: Gerar o APK debug**

```bash
cd apps/mobile
flutter build apk --debug --dart-define=TENANT=cahu --dart-define=API_URL=http://<IP-DO-NOTEBOOK>:3000/v1 --dart-define=APP_NOME="CAHU Delivery"
```

Expected: `Built build/app/outputs/flutter-apk/app-debug.apk`.

- [ ] **Step 3: Servir o APK pro celular baixar**

```bash
node ../../scratchpad/servir-apk.js
```

(ou o script equivalente já usado nas sessões anteriores — reinicia com nome versionado por mtime pra evitar cache de download no celular).

- [ ] **Step 4: Tiago testa no celular e reporta ajustes de altura/overflow, se houver**

Sem commit nesta task — é só geração de artefato pra validação visual real, mesmo padrão das últimas 3 features.

---

## Verificação final (fim a fim)

1. Cliente novo favorita um produto no celular → fecha e reabre o app → coração continua vermelho (persistiu no servidor).
2. Mesmo cliente loga num segundo aparelho (ou reinstala) → o produto favoritado aparece com coração vermelho (sincronizou).
3. Visitante toca o coração → cai no gate "Quase lá!" → cria conta → volta pro card já favoritado.
4. Produto sem promoção: preço preto, sem selo "%OFF". Produto em promoção: preço verde + "X% OFF" + preço de tabela riscado.
5. Nenhuma chamada de rede nova além de `GET /favoritos` (uma vez no boot) e `POST`/`DELETE /favoritos/:id` (por toque no coração).