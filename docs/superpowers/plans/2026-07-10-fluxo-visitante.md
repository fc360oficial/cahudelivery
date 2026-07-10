# Fluxo Visitante + Carrinho Anônimo + Identidade Amarela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cliente navega e monta carrinho sem login; login/cadastro só no checkout; identidade amarela `#FFD500` com logo transparente.

**Architecture:** Carrinho anônimo identificado por header `X-Device-Id` (UUID gerado no app); no login/cadastro a API mescla o carrinho do device no do cliente. Splash roteia para tela de CEP (1ª vez) e depois HomeShell sem exigir auth. Tema calcula foreground pela luminância da cor primária.

**Tech Stack:** NestJS + pg (apps/api), Flutter (apps/mobile), PostgreSQL 16 local (bancos `fluxo_control` e `fluxo_t_cahu`, senha dev `postgres`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-10-fluxo-visitante-design.md`.
- Nunca escrever no banco de ERP; apenas nos bancos locais do Fluxo Commerce.
- Código do app em português, singletons `ApiClient`/`TenantTheme`/`CarrinhoStore`, sem novos pacotes.
- `POST /pedidos`, pedidos, perfil e endereços continuam exigindo JWT.
- Item duplicado na mesclagem do carrinho: mantém a MAIOR quantidade.
- Flutter em `C:\dev\flutter\bin\flutter.bat`; API roda com `npm run start` em apps/api.
- Todo commit: mensagem em pt-BR + `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Migração SQL — carrinho anônimo

**Files:**
- Create: `11 - SQL/tenant/002_carrinho_anonimo.sql`

**Interfaces:**
- Produces: tabela `carrinhos` com `cliente_id uuid NULL`, `device_id text NULL`, check "exatamente um dono", únicos parciais `carrinhos_cliente_uk` e `carrinhos_device_uk` (usados nos `ON CONFLICT` das Tasks 2 e 3).

- [ ] **Step 1: Escrever a migração**

```sql
-- 002_carrinho_anonimo.sql — carrinho de visitante identificado por dispositivo.
-- Idempotente. Aplicar em cada banco de tenant (dev: fluxo_t_cahu).

alter table carrinhos alter column cliente_id drop not null;
alter table carrinhos add column if not exists device_id text;

-- o unique inline original vira índice parcial (necessário p/ on conflict)
alter table carrinhos drop constraint if exists carrinhos_cliente_id_key;
create unique index if not exists carrinhos_cliente_uk on carrinhos (cliente_id) where cliente_id is not null;
create unique index if not exists carrinhos_device_uk  on carrinhos (device_id)  where device_id  is not null;

alter table carrinhos drop constraint if exists carrinhos_dono_ck;
alter table carrinhos add constraint carrinhos_dono_ck
  check ((cliente_id is null) <> (device_id is null));
```

- [ ] **Step 2: Aplicar no banco dev**

Run (PowerShell): `$env:PGPASSWORD='postgres'; & "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -d fluxo_t_cahu -f "C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\002_carrinho_anonimo.sql"`
Expected: `ALTER TABLE` / `CREATE INDEX` sem erros. (Se o psql não estiver nesse caminho, localizar com `Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter psql.exe`.)

- [ ] **Step 3: Verificar**

Run: `$env:PGPASSWORD='postgres'; & "...\psql.exe" -U postgres -d fluxo_t_cahu -c "insert into carrinhos (device_id) values ('teste-device') returning id; delete from carrinhos where device_id='teste-device';"`
Expected: 1 linha inserida e apagada, sem violação de constraint.

- [ ] **Step 4: Commit**

```bash
git add "11 - SQL/tenant/002_carrinho_anonimo.sql"
git commit -m "SQL: carrinho anonimo por dispositivo (migracao 002)"
```

---

### Task 2: API — carrinho aceita visitante (X-Device-Id)

**Files:**
- Modify: `apps/api/src/orders/orders.service.ts`
- Modify: `apps/api/src/orders/orders.controller.ts`

**Interfaces:**
- Consumes: índices parciais da Task 1.
- Produces: `type DonoCarrinho = { clienteId?: string; deviceId?: string }` exportado de `orders.service.ts`; métodos `carrinho(dono)`, `upsertItem(dono, produtoId, quantidade)`, `removerItem(dono, produtoId)`. Task 3 usa o mesmo padrão de `ON CONFLICT`.

- [ ] **Step 1: Service — dono do carrinho**

Em `orders.service.ts`, substituir `carrinhoId`, `carrinho`, `upsertItem` e `removerItem` (e ajustar as chamadas internas de `criarPedido`/`repetir`):

```ts
export type DonoCarrinho = { clienteId?: string; deviceId?: string };

private async carrinhoId(dono: DonoCarrinho): Promise<string> {
  const { pool } = tenantCtx();
  // coluna vem de whitelist fixa — sem risco de injeção
  const [col, val] = dono.clienteId ? ['cliente_id', dono.clienteId] : ['device_id', dono.deviceId];
  const { rows } = await pool.query(
    `insert into carrinhos (${col}) values ($1)
     on conflict (${col}) where ${col} is not null do update set atualizado_em = now()
     returning id`,
    [val],
  );
  return rows[0].id;
}

async carrinho(dono: DonoCarrinho) {
  const { pool } = tenantCtx();
  const id = await this.carrinhoId(dono);
  const tabela = await this.catalog.tabelaPrecoDe(dono.clienteId);
  // ... (query de itens permanece idêntica, usando [id, tabela])
}

async upsertItem(dono: DonoCarrinho, produtoId: string, quantidade: number) {
  // igual ao atual, trocando clienteId por dono:
  //   carrinhoId(dono), tabelaPrecoDe(dono.clienteId), return this.carrinho(dono)
}

async removerItem(dono: DonoCarrinho, produtoId: string) {
  return this.upsertItem(dono, produtoId, 0);
}
```

Em `criarPedido` e `repetir` (continuam recebendo `clienteId: string`): trocar `await this.carrinho(clienteId)` por `await this.carrinho({ clienteId })` e `await this.carrinhoId(clienteId)` por `await this.carrinhoId({ clienteId })`.

- [ ] **Step 2: Controller — guards por rota**

Em `orders.controller.ts`: remover `@UseGuards(JwtAuthGuard)` do `@Controller()`; importar `OptionalAuthGuard`, `Headers` e `BadRequestException`.

```ts
type ReqClienteOpt = Request & { cliente?: ClienteLogado };

private dono(req: ReqClienteOpt, deviceId?: string): DonoCarrinho {
  if (req.cliente) return { clienteId: req.cliente.clienteId };
  if (deviceId) return { deviceId };
  throw new BadRequestException('Envie o header X-Device-Id ou autentique-se');
}

@Get('carrinho')
@UseGuards(OptionalAuthGuard)
carrinho(@Req() req: ReqClienteOpt, @Headers('x-device-id') deviceId?: string) {
  return this.orders.carrinho(this.dono(req, deviceId));
}

@Put('carrinho/itens')
@UseGuards(OptionalAuthGuard)
upsertItem(@Req() req: ReqClienteOpt, @Headers('x-device-id') deviceId: string | undefined, @Body() dto: ItemDto) {
  return this.orders.upsertItem(this.dono(req, deviceId), dto.produtoId, dto.quantidade);
}

@Delete('carrinho/itens/:produtoId')
@UseGuards(OptionalAuthGuard)
remover(@Req() req: ReqClienteOpt, @Headers('x-device-id') deviceId: string | undefined, @Param('produtoId', ParseUUIDPipe) produtoId: string) {
  return this.orders.removerItem(this.dono(req, deviceId), produtoId);
}
```

As rotas de pedidos (`criar`, `listar`, `detalhe`, `repetir`) ganham `@UseGuards(JwtAuthGuard)` individual e continuam usando `req.cliente.clienteId`.

- [ ] **Step 3: Build + smoke de visitante**

Run: `cd apps/api; npm run build` → Expected: sem erros TS.
Subir API (`npm run start`) e rodar:

```powershell
$h = @{'X-Tenant'='cahu'; 'X-Device-Id'='dev-teste-123'; 'Content-Type'='application/json'}
# produto do seed: Refrigerante d0000000-0000-4000-8000-000000000001
Invoke-RestMethod -Uri http://localhost:3000/v1/carrinho/itens -Method Put -Headers $h -Body '{"produtoId":"d0000000-0000-4000-8000-000000000001","quantidade":2}'
(Invoke-RestMethod -Uri http://localhost:3000/v1/carrinho -Headers $h).subtotal
```
Expected: subtotal `77.8` (2 × 38,90 da promoção). Sem header nem token → erro 400.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/orders
git commit -m "API: carrinho de visitante via X-Device-Id (OptionalAuthGuard)"
```

---

### Task 3: API — reivindicação do carrinho no login/cadastro (+ cadastro retorna tokens)

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`

**Interfaces:**
- Consumes: padrão `ON CONFLICT (cliente_id) where cliente_id is not null` da Task 1.
- Produces: `login(identificador, senha, deviceId?)`; `registrar(dados, deviceId?)` que passa a devolver `{ clienteId, status, accessToken, refreshToken }` (Task 6 do app depende dos tokens no cadastro).

- [ ] **Step 1: Service — mesclar carrinho e auto-login no cadastro**

Adicionar em `auth.service.ts`:

```ts
/** Mescla o carrinho anônimo do dispositivo no carrinho do cliente (maior quantidade vence). */
private async reivindicarCarrinho(clienteId: string, deviceId?: string) {
  if (!deviceId) return;
  const { pool } = tenantCtx();
  const dev = await pool.query(`select id from carrinhos where device_id = $1`, [deviceId]);
  if (!dev.rows[0]) return;
  const cli = await pool.query(
    `insert into carrinhos (cliente_id) values ($1)
     on conflict (cliente_id) where cliente_id is not null do update set atualizado_em = now()
     returning id`,
    [clienteId],
  );
  await pool.query(
    `insert into carrinho_itens (carrinho_id, produto_id, quantidade, preco_unit_snapshot)
     select $1, produto_id, quantidade, preco_unit_snapshot from carrinho_itens where carrinho_id = $2
     on conflict (carrinho_id, produto_id)
       do update set quantidade = greatest(carrinho_itens.quantidade, excluded.quantidade)`,
    [cli.rows[0].id, dev.rows[0].id],
  );
  await pool.query(`delete from carrinho_itens where carrinho_id = $1`, [dev.rows[0].id]);
  await pool.query(`delete from carrinhos where id = $1`, [dev.rows[0].id]);
}
```

`login(identificador, senha, deviceId?)`: após validar a senha e antes do `return`, chamar `await this.reivindicarCarrinho(reg.id, deviceId);`.

`registrar(dados, deviceId?)`: após o `commit`, fazer:

```ts
await this.reivindicarCarrinho(rows[0].id, deviceId);
const tokens = await this.emitirTokens(rows[0].id, tenantCtx().tenant.slug);
return { clienteId: rows[0].id, status: rows[0].status, ...tokens };
```

- [ ] **Step 2: Controller — repassar o header**

```ts
import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';

@Post('registrar')
registrar(@Body() dto: RegistrarDto, @Headers('x-device-id') deviceId?: string) {
  return this.auth.registrar(dto, deviceId);
}

@Post('login')
@HttpCode(200)
login(@Body() dto: LoginDto, @Headers('x-device-id') deviceId?: string) {
  return this.auth.login(dto.identificador, dto.senha, deviceId);
}
```

- [ ] **Step 3: Smoke da mesclagem**

Com o item da Task 2 ainda no carrinho do device `dev-teste-123`:

```powershell
$h = @{'X-Tenant'='cahu'; 'X-Device-Id'='dev-teste-123'; 'Content-Type'='application/json'}
$r = Invoke-RestMethod -Uri http://localhost:3000/v1/auth/login -Method Post -Headers $h -Body '{"identificador":"padaria@teste.com","senha":"123456"}'
$ha = @{'X-Tenant'='cahu'; 'Authorization'="Bearer $($r.accessToken)"}
(Invoke-RestMethod -Uri http://localhost:3000/v1/carrinho -Headers $ha).itens
```
Expected: item do refrigerante presente no carrinho do cliente; `select count(*) from carrinhos where device_id='dev-teste-123'` retorna 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth
git commit -m "API: reivindicacao do carrinho anonimo no login/cadastro; cadastro retorna tokens"
```

---

### Task 4: App — deviceId no ApiClient e carrinho sem exigir login

**Files:**
- Modify: `apps/mobile/lib/core/api_client.dart`
- Modify: `apps/mobile/lib/core/carrinho_store.dart`

**Interfaces:**
- Produces: todo request do app leva `X-Device-Id`; `CarrinhoStore.carregar()` funciona deslogado (Tasks 5–7 assumem isso).

- [ ] **Step 1: ApiClient — gerar e enviar deviceId**

```dart
import 'dart:math';

String? _deviceId;

Future<void> carregarSessao() async {
  final prefs = await SharedPreferences.getInstance();
  _accessToken = prefs.getString('accessToken');
  _refreshToken = prefs.getString('refreshToken');
  _deviceId = prefs.getString('deviceId');
  if (_deviceId == null) {
    _deviceId = _uuidV4();
    await prefs.setString('deviceId', _deviceId!);
  }
}

/// UUID v4 sem dependência externa.
static String _uuidV4() {
  final r = Random.secure();
  String hex(int n) => List.generate(n, (_) => r.nextInt(16).toRadixString(16)).join();
  return '${hex(8)}-${hex(4)}-4${hex(3)}-${'89ab'[r.nextInt(4)]}${hex(3)}-${hex(12)}';
}
```

No mapa de headers de `_send`, acrescentar: `if (_deviceId != null) 'X-Device-Id': _deviceId!,`.
Em `sair()`: NÃO apagar o deviceId (só tokens).

- [ ] **Step 2: CarrinhoStore — carregar sempre**

Em `carregar()`, remover a linha `if (!ApiClient.instance.logado) return;`.

- [ ] **Step 3: Verificar**

Run: `cd apps/mobile; C:\dev\flutter\bin\flutter.bat analyze` → Expected: `No issues found!`
Run: `C:\dev\flutter\bin\flutter.bat test` → Expected: `All tests passed!`

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/core
git commit -m "App: X-Device-Id em todo request; carrinho funciona sem login"
```

---

### Task 5: App — tela de CEP + splash sem exigir login

**Files:**
- Create: `apps/mobile/lib/features/onboarding/cep_screen.dart`
- Modify: `apps/mobile/lib/features/splash/splash_screen.dart`
- Test: `apps/mobile/test/cep_screen_test.dart`

**Interfaces:**
- Consumes: `HomeShell` existente.
- Produces: prefs `cepVisto` (bool) e `cep` (string) — usados pelo splash e, futuramente, como sugestão no cadastro de endereço.

- [ ] **Step 1: Teste que falha**

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:fluxo_commerce_app/features/onboarding/cep_screen.dart';

void main() {
  testWidgets('tela de CEP renderiza campo e ações', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CepScreen()));
    expect(find.text('Qual o CEP de entrega?'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Confirmar'), findsOneWidget);
    expect(find.text('Pular por agora'), findsOneWidget);
  });
}
```

Run: `C:\dev\flutter\bin\flutter.bat test test/cep_screen_test.dart` → Expected: FAIL (arquivo não existe).

- [ ] **Step 2: Implementar CepScreen**

```dart
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../shell/home_shell.dart';

/// Primeira tela do visitante: captura o CEP de entrega (pode pular).
/// Só salva localmente — validação de área de entrega depende de decisão
/// de negócio da CAHU (pergunta 6 do ESCOPO).
class CepScreen extends StatefulWidget {
  const CepScreen({super.key});

  @override
  State<CepScreen> createState() => _CepScreenState();
}

class _CepScreenState extends State<CepScreen> {
  final _cep = TextEditingController();
  String? _localidade; // "Bairro · Cidade/UF" vindo do ViaCEP
  bool _buscando = false;

  @override
  void dispose() {
    _cep.dispose();
    super.dispose();
  }

  Future<void> _buscar() async {
    final cep = _cep.text.replaceAll(RegExp(r'\D'), '');
    if (cep.length != 8) return;
    setState(() => _buscando = true);
    try {
      final r = await http
          .get(Uri.parse('https://viacep.com.br/ws/$cep/json/'))
          .timeout(const Duration(seconds: 6));
      final d = jsonDecode(r.body) as Map<String, dynamic>;
      if (mounted && d['erro'] != true) {
        setState(() => _localidade =
            '${d['bairro'] ?? ''} · ${d['localidade']}/${d['uf']}'.replaceFirst(RegExp(r'^ · '), ''));
      }
    } catch (_) {
      // ViaCEP fora do ar não impede confirmar
    } finally {
      if (mounted) setState(() => _buscando = false);
    }
  }

  Future<void> _seguir({required bool salvarCep}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('cepVisto', true);
    if (salvarCep) await prefs.setString('cep', _cep.text.replaceAll(RegExp(r'\D'), ''));
    if (!mounted) return;
    Navigator.of(context)
        .pushReplacement(MaterialPageRoute(builder: (_) => const HomeShell()));
  }

  @override
  Widget build(BuildContext context) {
    final cepOk = _cep.text.replaceAll(RegExp(r'\D'), '').length == 8;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.location_on_outlined,
                      size: 56, color: Theme.of(context).colorScheme.primary),
                  const SizedBox(height: 16),
                  const Text('Qual o CEP de entrega?',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text('Usamos para preparar seu cadastro de entrega.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, color: Colors.grey.shade600)),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _cep,
                    keyboardType: TextInputType.number,
                    maxLength: 9,
                    decoration: InputDecoration(
                      labelText: 'CEP',
                      counterText: '',
                      suffixIcon: _buscando
                          ? const Padding(
                              padding: EdgeInsets.all(12),
                              child: SizedBox(
                                  width: 20, height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2)))
                          : null,
                    ),
                    onChanged: (v) {
                      setState(() {});
                      if (v.replaceAll(RegExp(r'\D'), '').length == 8) _buscar();
                    },
                  ),
                  if (_localidade != null) ...[
                    const SizedBox(height: 8),
                    Text(_localidade!,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: Colors.green.shade700)),
                  ],
                  const SizedBox(height: 20),
                  FilledButton(
                    onPressed: cepOk ? () => _seguir(salvarCep: true) : null,
                    child: const Text('Confirmar'),
                  ),
                  TextButton(
                    onPressed: () => _seguir(salvarCep: false),
                    child: const Text('Pular por agora'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 3: Splash roteia por CEP, não por login**

Em `splash_screen.dart`, substituir o `_boot` e imports relacionados:

```dart
import 'package:shared_preferences/shared_preferences.dart';
import '../onboarding/cep_screen.dart';
// remover import de api_client.dart e login_screen.dart se ficarem sem uso

Future<void> _boot() async {
  await TenantTheme.instance.carregar();
  final prefs = await SharedPreferences.getInstance();
  final cepVisto = prefs.getBool('cepVisto') ?? false;
  await Future.delayed(const Duration(milliseconds: 600));
  if (!mounted) return;
  Navigator.of(context).pushReplacement(
    MaterialPageRoute(builder: (_) => cepVisto ? const HomeShell() : const CepScreen()),
  );
}
```

- [ ] **Step 4: Testes**

Run: `C:\dev\flutter\bin\flutter.bat test` → Expected: todos passam (o teste do CEP incluído).
Run: `C:\dev\flutter\bin\flutter.bat analyze` → Expected: `No issues found!`

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/features/onboarding apps/mobile/lib/features/splash apps/mobile/test
git commit -m "App: tela de CEP no primeiro acesso; splash nao exige mais login"
```

---

### Task 6: App — gate "Entrar ou criar conta" no checkout

**Files:**
- Create: `apps/mobile/lib/features/auth/entrar_ou_criar_screen.dart`
- Modify: `apps/mobile/lib/features/auth/login_screen.dart`
- Modify: `apps/mobile/lib/features/auth/cadastro_screen.dart`
- Modify: `apps/mobile/lib/features/cart/carrinho_screen.dart`

**Interfaces:**
- Consumes: `registrar` devolvendo tokens (Task 3); `CarrinhoStore.carregar()` sem login (Task 4).
- Produces: `LoginScreen({bool retornarAoLogar = false})`, `CadastroScreen({bool retornarAoLogar = false})`, `EntrarOuCriarScreen` que resolve `Navigator.pop(context, true)` quando autenticou.

- [ ] **Step 1: LoginScreen com modo retorno**

Construtor: `const LoginScreen({super.key, this.retornarAoLogar = false}); final bool retornarAoLogar;`
No sucesso do `_entrar` (após `salvarTokens`):

```dart
if (widget.retornarAoLogar) {
  Navigator.of(context).pop(true);
} else {
  Navigator.of(context).pushReplacement(
    MaterialPageRoute(builder: (_) => const HomeShell()),
  );
}
```

O botão "Criar minha conta" passa a propagar o modo: `CadastroScreen(retornarAoLogar: widget.retornarAoLogar)` e, se o push devolver `true`, faz `Navigator.of(context).pop(true)`.

- [ ] **Step 2: CadastroScreen auto-loga com os tokens da API**

Construtor: `const CadastroScreen({super.key, this.retornarAoLogar = false}); final bool retornarAoLogar;`
No sucesso do `_cadastrar` (a resposta agora traz `accessToken`/`refreshToken`):

```dart
await ApiClient.instance.salvarTokens(r['accessToken'], r['refreshToken']);
if (!mounted) return;
if (r['status'] != 'aprovado' && r['status'] != 'ativo') {
  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('Cadastro em análise pela distribuidora — você já pode navegar e montar pedidos.')));
}
if (widget.retornarAoLogar) {
  Navigator.of(context).pop(true);
} else {
  Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const HomeShell()), (_) => false);
}
```

(Remover o `showDialog` antigo e o `Navigator.pop` simples.)

- [ ] **Step 3: EntrarOuCriarScreen**

```dart
import 'package:flutter/material.dart';

import '../../core/config.dart';
import '../../core/tenant_theme.dart';
import 'cadastro_screen.dart';
import 'login_screen.dart';

/// Gate do checkout para visitante: autentica e devolve `true` ao carrinho.
class EntrarOuCriarScreen extends StatelessWidget {
  const EntrarOuCriarScreen({super.key});

  Future<void> _abrir(BuildContext context, Widget tela) async {
    final ok = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => tela));
    if (ok == true && context.mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final t = TenantTheme.instance;
    return Scaffold(
      appBar: AppBar(title: const Text('Quase lá!')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset(AppBuildConfig.logoAsset, height: 90,
                      errorBuilder: (_, e, s) => Text(t.appNome,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                              fontSize: 26, fontWeight: FontWeight.w800))),
                  const SizedBox(height: 20),
                  const Text('Para finalizar seu pedido, entre na sua conta ou crie uma agora.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 15, height: 1.45)),
                  const SizedBox(height: 28),
                  FilledButton(
                    onPressed: () =>
                        _abrir(context, const LoginScreen(retornarAoLogar: true)),
                    child: const Text('Já tenho conta'),
                  ),
                  const SizedBox(height: 10),
                  OutlinedButton(
                    onPressed: () =>
                        _abrir(context, const CadastroScreen(retornarAoLogar: true)),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Criar minha conta'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Carrinho chama o gate**

Em `carrinho_screen.dart`, o `onPressed` do "Finalizar pedido" vira:

```dart
onPressed: atingiu || minimo <= 0
    ? () async {
        if (!ApiClient.instance.logado) {
          final ok = await Navigator.of(context).push<bool>(
              MaterialPageRoute(builder: (_) => const EntrarOuCriarScreen()));
          if (ok != true) return;
          await CarrinhoStore.instance.carregar(); // carrinho já mesclado pela API
        }
        if (context.mounted) {
          Navigator.of(context)
              .push(MaterialPageRoute(builder: (_) => const CheckoutScreen()));
        }
      }
    : null,
```

(Adicionar imports de `api_client.dart` e `entrar_ou_criar_screen.dart`.)

- [ ] **Step 5: Verificar e commitar**

Run: `C:\dev\flutter\bin\flutter.bat analyze` e `flutter.bat test` → Expected: limpos.

```bash
git add apps/mobile/lib/features/auth apps/mobile/lib/features/cart
git commit -m "App: gate entrar/criar conta no checkout; cadastro auto-loga"
```

---

### Task 7: App — convite de login nas abas Pedidos e Perfil

**Files:**
- Create: `apps/mobile/lib/widgets/convite_login.dart`
- Modify: `apps/mobile/lib/features/orders/pedidos_screen.dart`
- Modify: `apps/mobile/lib/features/profile/perfil_screen.dart`

**Interfaces:**
- Consumes: `LoginScreen/CadastroScreen(retornarAoLogar: true)` da Task 6.
- Produces: `ConviteLogin({required IconData icone, required String titulo, required VoidCallback onAutenticado})`.

- [ ] **Step 1: Widget ConviteLogin**

```dart
import 'package:flutter/material.dart';

import '../features/auth/cadastro_screen.dart';
import '../features/auth/login_screen.dart';

/// Estado "visitante" das abas que exigem conta (Pedidos, Perfil).
class ConviteLogin extends StatelessWidget {
  const ConviteLogin({
    super.key,
    required this.icone,
    required this.titulo,
    required this.onAutenticado,
  });

  final IconData icone;
  final String titulo;
  final VoidCallback onAutenticado;

  Future<void> _abrir(BuildContext context, Widget tela) async {
    final ok = await Navigator.of(context)
        .push<bool>(MaterialPageRoute(builder: (_) => tela));
    if (ok == true) onAutenticado();
  }

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Icon(icone, size: 64, color: Colors.grey.shade400),
              const SizedBox(height: 16),
              Text(titulo,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: () =>
                    _abrir(context, const LoginScreen(retornarAoLogar: true)),
                child: const Text('Entrar'),
              ),
              TextButton(
                onPressed: () =>
                    _abrir(context, const CadastroScreen(retornarAoLogar: true)),
                child: const Text('Criar minha conta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: PedidosScreen e PerfilScreen usam o convite**

Nos dois arquivos, importar `api_client.dart` e `convite_login.dart`. No início do `body` do `build`:

```dart
// PedidosScreen
if (!ApiClient.instance.logado) {
  return Scaffold(
    appBar: AppBar(title: const Text('Meus pedidos')),
    body: ConviteLogin(
      icone: Icons.receipt_long_outlined,
      titulo: 'Entre para ver seus pedidos',
      onAutenticado: () => setState(_recarregar),
    ),
  );
}

// PerfilScreen (mesmo padrão)
if (!ApiClient.instance.logado) {
  return Scaffold(
    appBar: AppBar(title: const Text('Perfil')),
    body: ConviteLogin(
      icone: Icons.person_outline,
      titulo: 'Entre para ver seu perfil',
      onAutenticado: () => setState(_carregar),
    ),
  );
}
```

Nos `initState`/`_carregar` dessas telas, sair cedo se `!ApiClient.instance.logado` (evita chamada 401 ao abrir a aba como visitante).

- [ ] **Step 3: Sair vira "voltar a visitante"**

Em `perfil_screen.dart`, o `_sair` deixa de navegar para `LoginScreen`:

```dart
await ApiClient.instance.sair();
CarrinhoStore.instance.limpar();
await CarrinhoStore.instance.carregar(); // carrinho novo do device
if (mounted) setState(() {});
```

(Remover import de `login_screen.dart` se ficar sem uso.)

- [ ] **Step 4: Verificar e commitar**

Run: `flutter.bat analyze` + `flutter.bat test` → limpos.

```bash
git add apps/mobile/lib/widgets/convite_login.dart apps/mobile/lib/features/orders apps/mobile/lib/features/profile
git commit -m "App: abas Pedidos/Perfil com convite de login para visitante"
```

---

### Task 8: Visual — amarelo #FFD500, foreground por luminância e logo transparente

**Files:**
- Modify: banco `fluxo_control` (update em `tenant_temas`)
- Modify: `apps/mobile/lib/core/tenant_theme.dart`
- Modify: `apps/mobile/lib/features/splash/splash_screen.dart`
- Modify: `apps/mobile/lib/features/catalog/produtos_screen.dart`
- Modify: `apps/mobile/assets/logo/cahu.png` (reprocessado)

- [ ] **Step 1: Cor no banco**

```powershell
$env:PGPASSWORD='postgres'; & "...\psql.exe" -U postgres -d fluxo_control -c "update tenant_temas set cor_primaria='#FFD500', cor_secundaria='#1A1A1A' where tenant_id = (select id from tenants where slug='cahu');"
```
Expected: `UPDATE 1`. Confirmar com `GET /v1/config` → `tema.cor_primaria == '#FFD500'` (reiniciar a API se houver cache).

- [ ] **Step 2: TenantTheme calcula o foreground**

```dart
/// Cor de texto/ícone legível sobre a cor primária (escuro sobre amarelo).
Color get corSobrePrimaria =>
    corPrimaria.computeLuminance() > 0.5 ? const Color(0xFF1A1A1A) : Colors.white;

ThemeData buildTheme() {
  final base = ColorScheme.fromSeed(seedColor: corPrimaria, primary: corPrimaria);
  final scheme = base.copyWith(onPrimary: corSobrePrimaria);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF7F7F9),
    appBarTheme: AppBarTheme(
      backgroundColor: corPrimaria,
      foregroundColor: corSobrePrimaria,
      elevation: 0,
      centerTitle: false,
    ),
    // filledButtonTheme/inputDecorationTheme/cardTheme permanecem como estão
  );
}
```

- [ ] **Step 3: Pontos com branco fixo**

- `splash_screen.dart`: `_logoLocal` perde o `Container` branco (retorna só o `Image.asset(width: 200)`); spinner e `_nome` usam `t.corSobrePrimaria` no lugar de `Colors.white`.
- `produtos_screen.dart` (modo busca e chips): trocar `Colors.white` por `Theme.of(context).colorScheme.onPrimary` e `Colors.white70` por `Theme.of(context).colorScheme.onPrimary.withValues(alpha: 0.7)` (TextField do AppBar, `cursorColor`, `labelStyle` e `backgroundColor` dos chips).

- [ ] **Step 4: Logo transparente**

```powershell
Add-Type -AssemblyName System.Drawing
$p = "C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\fluxo-commerce\apps\mobile\assets\logo\cahu.png"
$src = New-Object System.Drawing.Bitmap($p)
$out = New-Object System.Drawing.Bitmap($src.Width, $src.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
for ($y=0; $y -lt $src.Height; $y++) { for ($x=0; $x -lt $src.Width; $x++) {
  $c = $src.GetPixel($x,$y)
  if ($c.R -ge 240 -and $c.G -ge 240 -and $c.B -ge 240) {
    $out.SetPixel($x,$y,[System.Drawing.Color]::FromArgb(0,255,255,255))
  } else { $out.SetPixel($x,$y,$c) }
} }
$src.Dispose(); $out.Save("$p.tmp",[System.Drawing.Imaging.ImageFormat]::Png); $out.Dispose()
Move-Item "$p.tmp" $p -Force
```
(GetPixel/SetPixel em 2897×1052 leva ~1–2 min; aceitável por ser único. O logo é preto — sobre amarelo fica legível sem moldura.)

- [ ] **Step 5: Verificar e commitar**

Run: `flutter.bat analyze` + `flutter.bat test` → limpos. Subir app web e conferir: AppBar amarela com texto escuro, splash amarelo com logo sem fundo, chips legíveis.

```bash
git add apps/mobile
git commit -m "Visual: amarelo #FFD500 com foreground por luminancia; logo sem fundo branco"
```

---

### Task 9: Validação E2E do fluxo visitante

**Files:** nenhum (validação).

- [ ] **Step 1: Ciclo completo no Flutter web**

Subir API (`npm run start` em apps/api) e app (`flutter.bat run -d web-server --web-port 8080 --dart-define=API_URL=http://localhost:3000/v1`). Num navegador anônimo:
1. Splash → tela de CEP aparece (1ª vez); "Pular por agora" → Home SEM login.
2. Adicionar produto ao carrinho como visitante → badge atualiza.
3. Aba Pedidos → convite "Entre para ver seus pedidos".
4. Carrinho → "Finalizar pedido" → gate → "Já tenho conta" → login `padaria@teste.com`/`123456` → cai no Checkout com o MESMO carrinho.
5. Concluir o pedido → tela de sucesso.
6. Perfil → Sair → app continua navegável como visitante.

- [ ] **Step 2: Atualizar memória do projeto e encerrar**

Atualizar `project_fluxo-commerce.md` (status: fluxo visitante entregue) e conferir `git log` com todos os commits das Tasks 1–8.
