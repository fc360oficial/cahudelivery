# Inscrição Estadual e código do município — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coletar Inscrição Estadual no cadastro CNPJ do app e resolver o código IBGE do município sem nunca perguntar nada ao cliente, exibindo os dois numa Ficha na Retaguarda para o operador cadastrar o cliente no ERP.

**Architecture:** O app manda a IE (ou `ISENTO`) e o código IBGE que o ViaCEP já devolve de graça na busca de CEP que hoje existe. A API valida a IE por uma função pura e grava. Quando o código do município não vem, um worker diário — cópia estrutural do `GeocodificacaoWorker` — resolve pela API de municípios do IBGE por cidade+UF, o que também faz o backfill de toda a base já cadastrada. O Dlinks ganha um campo opcional de entrada que preenche a IE de quem veio do ERP sem nunca apagar a que o cliente digitou.

**Tech Stack:** NestJS 11 + PostgreSQL 16 (`apps/api`), React + Vite (`apps/admin`), Flutter/Dart (`apps/mobile`), Jest na API, `flutter_test` no app.

**Spec:** `docs/superpowers/specs/2026-09-22-ie-e-codigo-municipio-design.md`

## Global Constraints

- **Nada é escrito no ERP.** O worker e todos os endpoints só escrevem em `clientes` e `cliente_enderecos`.
- **Migrações são idempotentes** (`add column if not exists`) e vivem em `infra/sql/tenant/`, espelhadas em `11 - SQL/tenant/` (fora do repo, `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant`). São aplicadas em ordem de nome por `infra/scripts/provisionar-tenant.ps1`.
- **Texto de interface em português**, sem abreviação inventada. Código, nomes de variável e commits em português, como o resto do repositório.
- **Commits sem acento** nas mensagens (padrão do histórico: `git log --oneline`).
- **IE isenta é gravada como a string literal `ISENTO`**, nunca `null`, nunca string vazia.
- **IE válida = 8 a 14 dígitos.** Não existe validação de dígito verificador: cada UF tem regra própria.
- **O documento externo do Dlinks nunca menciona SB Vendas nem SoftBuilder.**
- Testes da API: `npm test --workspace apps/api`. Testes do app: `flutter test` dentro de `apps/mobile`.

---

### Task 1: Migração 028 — colunas de IE e município

**Files:**
- Create: `infra/sql/tenant/028_ie_e_municipio.sql`
- Create (fora do repo, cópia idêntica): `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\028_ie_e_municipio.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `clientes.inscricao_estadual text`, `cliente_enderecos.codigo_municipio text`, `cliente_enderecos.municipio_tentativas int not null default 0`, `cliente_enderecos.municipio_ultima_tentativa_em timestamptz`. Todas as tasks seguintes dependem destas colunas.

- [ ] **Step 1: Escrever a migração**

Criar `infra/sql/tenant/028_ie_e_municipio.sql`:

```sql
-- 028: Inscricao Estadual do cliente e codigo IBGE do municipio do endereco.
-- A IE fica em clientes porque e atributo do CNPJ. O codigo do municipio fica
-- em cliente_enderecos porque um cliente com dois enderecos tem dois municipios.
alter table clientes
  add column if not exists inscricao_estadual text;

alter table cliente_enderecos
  add column if not exists codigo_municipio              text,
  add column if not exists municipio_tentativas          int not null default 0,
  add column if not exists municipio_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_municipio_pendente_idx
  on cliente_enderecos (municipio_tentativas) where codigo_municipio is null;
```

- [ ] **Step 2: Aplicar no banco local e verificar**

Run:
```bash
psql -U postgres -d fluxo_t_cahu -f "infra/sql/tenant/028_ie_e_municipio.sql"
psql -U postgres -d fluxo_t_cahu -c "\d cliente_enderecos"
```
Expected: a saída de `\d` lista `codigo_municipio`, `municipio_tentativas` e `municipio_ultima_tentativa_em`.

- [ ] **Step 3: Verificar que é idempotente**

Run: `psql -U postgres -d fluxo_t_cahu -f "infra/sql/tenant/028_ie_e_municipio.sql"`
Expected: roda de novo sem erro (só `NOTICE ... already exists`).

- [ ] **Step 4: Espelhar fora do repo**

Run:
```bash
cp "infra/sql/tenant/028_ie_e_municipio.sql" "/c/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/11 - SQL/tenant/028_ie_e_municipio.sql"
```

- [ ] **Step 5: Commit**

```bash
git add infra/sql/tenant/028_ie_e_municipio.sql
git commit -m "Migracao 028: inscricao estadual e codigo do municipio"
```

---

### Task 2: Regra da Inscrição Estadual na API

**Files:**
- Create: `apps/api/src/auth/inscricao-estadual.ts`
- Create: `apps/api/src/auth/inscricao-estadual.spec.ts`
- Modify: `apps/api/src/auth/auth.controller.ts` (`EnderecoCadastroDto` e `RegistrarDto`, topo do arquivo)
- Modify: `apps/api/src/auth/auth.service.ts` (assinatura e corpo de `registrar`)

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `resolverInscricaoEstadual(e: EntradaIe): ResultadoIe` exportado de `apps/api/src/auth/inscricao-estadual.ts`. `RegistrarDto` passa a aceitar `inscricaoEstadual?: string`, `isentoIe?: boolean` e `endereco.codigoMunicipio?: string` — a Task 3 (app) envia exatamente esses nomes.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/auth/inscricao-estadual.spec.ts`:

```ts
import { resolverInscricaoEstadual } from './inscricao-estadual';

describe('resolverInscricaoEstadual', () => {
  it('CPF nunca grava IE, mesmo se vier no payload', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CPF', inscricaoEstadual: '123456789' })).toEqual({ ok: true, valor: null });
  });

  it('CNPJ isento grava a string ISENTO', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', isentoIe: true })).toEqual({ ok: true, valor: 'ISENTO' });
  });

  it('isento ganha da IE preenchida', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', isentoIe: true, inscricaoEstadual: '0612345' })).toEqual({ ok: true, valor: 'ISENTO' });
  });

  it('CNPJ com IE grava so os digitos', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '06.123.456-7' })).toEqual({ ok: true, valor: '061234567' });
  });

  it('CNPJ sem IE e sem isento e recusado', () => {
    const r = resolverInscricaoEstadual({ tipo: 'CNPJ' });
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, erro: 'Informe a Inscricao Estadual ou marque Isento' });
  });

  it('IE curta ou longa demais e recusada', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '1234567' }).ok).toBe(false);
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '123456789012345' }).ok).toBe(false);
  });

  it('aceita os extremos de 8 e 14 digitos', () => {
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '12345678' })).toEqual({ ok: true, valor: '12345678' });
    expect(resolverInscricaoEstadual({ tipo: 'CNPJ', inscricaoEstadual: '12345678901234' })).toEqual({ ok: true, valor: '12345678901234' });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test --workspace apps/api -- inscricao-estadual`
Expected: FAIL — `Cannot find module './inscricao-estadual'`.

- [ ] **Step 3: Escrever a implementação mínima**

Criar `apps/api/src/auth/inscricao-estadual.ts`:

```ts
export interface EntradaIe {
  tipo: 'CPF' | 'CNPJ';
  inscricaoEstadual?: string;
  isentoIe?: boolean;
}

export type ResultadoIe = { ok: true; valor: string | null } | { ok: false; erro: string };

/**
 * Regra da IE no cadastro, isolada aqui para ser testável sem banco.
 *
 * Devolve o que gravar em `clientes.inscricao_estadual`: `null` para CPF,
 * a string literal `ISENTO` para quem marcou isento, ou só os dígitos da IE.
 *
 * Não valida dígito verificador: cada UF tem sua própria regra e manter as 27
 * não compensa. Só o comprimento (8 a 14) é conferido — IE errada aparece no ERP.
 */
export function resolverInscricaoEstadual(e: EntradaIe): ResultadoIe {
  if (e.tipo !== 'CNPJ') return { ok: true, valor: null };
  if (e.isentoIe === true) return { ok: true, valor: 'ISENTO' };
  const digitos = (e.inscricaoEstadual ?? '').replace(/\D/g, '');
  if (!digitos) return { ok: false, erro: 'Informe a Inscricao Estadual ou marque Isento' };
  if (digitos.length < 8 || digitos.length > 14) return { ok: false, erro: 'Inscricao Estadual invalida' };
  return { ok: true, valor: digitos };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm test --workspace apps/api -- inscricao-estadual`
Expected: PASS, 7 testes.

- [ ] **Step 5: Adicionar os campos aos DTOs**

Em `apps/api/src/auth/auth.controller.ts`, acrescentar `IsBoolean` ao import de `class-validator` (a linha 2 já importa vários símbolos de lá) e os campos novos:

Em `EnderecoCadastroDto`, depois de `@Length(2, 2) uf!: string;`:

```ts
  /** Código IBGE do município, capturado do ViaCEP pelo app. O cliente nunca digita. */
  @IsOptional() @IsString() codigoMunicipio?: string;
```

Em `RegistrarDto`, depois de `@IsOptional() @IsString() categoria?: string;`:

```ts
  @IsOptional() @IsString() inscricaoEstadual?: string;
  @IsOptional() @IsBoolean() isentoIe?: boolean;
```

- [ ] **Step 6: Usar a regra no `registrar`**

Em `apps/api/src/auth/auth.service.ts`:

Acrescentar o import no topo:

```ts
import { resolverInscricaoEstadual } from './inscricao-estadual';
```

No tipo do parâmetro `dados` de `registrar`, acrescentar dentro de `endereco` (depois de `uf: string;`):

```ts
        codigoMunicipio?: string;
```

e no nível de cima, depois de `categoria?: string;`:

```ts
      inscricaoEstadual?: string;
      isentoIe?: boolean;
```

Logo depois de `const doc = dados.documento.replace(/\D/g, '');`, antes de `pool.connect()` (validar antes de abrir conexão e transação):

```ts
    const ie = resolverInscricaoEstadual(dados);
    if (!ie.ok) throw new BadRequestException(ie.erro);
```

`BadRequestException` já está importado no arquivo (é usado no código de indicação).

Trocar o insert de `clientes` por:

```ts
      const { rows } = await client.query(
        `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, telefone, categoria, codigo_indicacao, indicado_por_cliente_id, inscricao_estadual)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, status`,
        [
          dados.tipo,
          doc,
          dados.razaoSocial ?? null,
          dados.nomeFantasia,
          dados.email?.trim().toLowerCase() || null,
          dados.telefone.trim(),
          dados.categoria ?? null,
          codigoIndicacao,
          indicadoPorClienteId,
          ie.valor,
        ],
      );
```

Trocar o insert de `cliente_enderecos` por:

```ts
      await client.query(
        `insert into cliente_enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao, codigo_municipio)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`,
        [
          rows[0].id,
          e.cep.replace(/\D/g, ''),
          e.logradouro.trim(),
          e.numero.trim(),
          e.complemento?.trim() || null,
          e.bairro.trim(),
          e.cidade.trim(),
          e.uf.trim().toUpperCase(),
          e.codigoMunicipio?.replace(/\D/g, '') || null,
        ],
      );
```

> Conferir o `e.uf` dessa lista contra o código atual antes de colar: o insert original termina em `e.uf...` e a lista acima precisa bater exatamente com os parâmetros `$1..$9` na mesma ordem.

- [ ] **Step 7: Compilar e rodar a suíte inteira**

Run: `npm run build --workspace apps/api && npm test --workspace apps/api`
Expected: build sem erro de tipo, todos os testes passando.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/inscricao-estadual.ts apps/api/src/auth/inscricao-estadual.spec.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.service.ts
git commit -m "Aceita inscricao estadual e codigo do municipio no cadastro"
```

---

### Task 3: Campo de IE e captura do IBGE no app

**Files:**
- Modify: `apps/mobile/lib/features/auth/cadastro_screen.dart`
- Modify: `apps/mobile/test/widget_test.dart`

**Interfaces:**
- Consumes: `POST /auth/registrar` com `inscricaoEstadual`, `isentoIe` e `endereco.codigoMunicipio` (Task 2).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `apps/mobile/test/widget_test.dart` (mantendo o teste de login que já existe e acrescentando o import):

```dart
import 'package:fluxo_commerce_app/features/auth/cadastro_screen.dart';
```

```dart
  testWidgets('IE aparece no modo CNPJ e some no modo CPF', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: CadastroScreen()));

    // CNPJ é o modo inicial.
    expect(find.text('Inscrição Estadual'), findsOneWidget);
    expect(find.text('Isento de Inscrição Estadual'), findsOneWidget);

    await tester.tap(find.text('Pessoa física (CPF)'));
    await tester.pumpAndSettle();

    expect(find.text('Inscrição Estadual'), findsNothing);
    expect(find.text('Isento de Inscrição Estadual'), findsNothing);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/mobile && flutter test test/widget_test.dart`
Expected: FAIL — `Expected: exactly one matching candidate / Actual: _TextFinder:<zero widgets>` no `find.text('Inscrição Estadual')`.

- [ ] **Step 3: Adicionar estado e limpeza de estado**

Em `_CadastroScreenState`, junto dos outros controllers:

```dart
  final _inscricaoEstadual = TextEditingController();
  bool _isentoIe = false;
  String? _codigoMunicipio;
```

Acrescentar `_inscricaoEstadual` à lista do `dispose()`.

Trocar o `onSelectionChanged` do `SegmentedButton` por:

```dart
                onSelectionChanged: (s) => setState(() {
                  _tipo = s.first;
                  // CPF não tem IE: limpar evita mandar IE de pessoa física no payload.
                  if (_tipo != 'CNPJ') {
                    _inscricaoEstadual.clear();
                    _isentoIe = false;
                  }
                }),
```

- [ ] **Step 4: Adicionar os campos de IE**

Dentro do bloco `if (ehCnpj) ...[`, logo depois do `TextFormField` da Razão social (antes do `],` que fecha o bloco):

```dart
                const SizedBox(height: 14),
                TextFormField(
                  controller: _inscricaoEstadual,
                  enabled: !_isentoIe,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Inscrição Estadual',
                  ),
                  validator: (v) {
                    if (!ehCnpj || _isentoIe) return null;
                    final d = (v ?? '').replaceAll(RegExp(r'\D'), '');
                    if (d.isEmpty) return 'Informe a IE ou marque Isento';
                    return d.length >= 8 && d.length <= 14
                        ? null
                        : 'Inscrição Estadual inválida';
                  },
                ),
                CheckboxListTile(
                  value: _isentoIe,
                  onChanged: (v) => setState(() {
                    _isentoIe = v ?? false;
                    if (_isentoIe) _inscricaoEstadual.clear();
                  }),
                  title: const Text('Isento de Inscrição Estadual'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                ),
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/mobile && flutter test test/widget_test.dart`
Expected: PASS, 2 testes.

- [ ] **Step 6: Capturar o código IBGE do ViaCEP**

Em `_buscarCep`, dentro do `if (d['erro'] != true && mounted) {`, acrescentar depois de `_uf.text = d['uf'] ?? _uf.text;`:

```dart
        // O ViaCEP já devolve o código IBGE do município: o ERP precisa dele e
        // o cliente não saberia informar. Nenhum campo é mostrado na tela.
        _codigoMunicipio = (d['ibge'] as String?)?.trim();
```

No `onChanged` do campo de CEP, zerar o município antes de buscar, para o CEP corrigido não herdar o município do CEP anterior:

```dart
                onChanged: (v) {
                  _codigoMunicipio = null;
                  if (v.replaceAll(RegExp(r'\D'), '').length == 8) _buscarCep();
                },
```

- [ ] **Step 7: Mandar tudo no payload**

Em `_cadastrar`, dentro do mapa enviado ao `/auth/registrar`:

Depois de `if (_categoria != null) 'categoria': _categoria,`:

```dart
                if (ehCnpjSelecionado && _isentoIe) 'isentoIe': true,
                if (ehCnpjSelecionado && !_isentoIe && _inscricaoEstadual.text.trim().isNotEmpty)
                  'inscricaoEstadual': _inscricaoEstadual.text.replaceAll(RegExp(r'\D'), ''),
```

E dentro do mapa `'endereco'`, depois de `'uf': ...`:

```dart
                  if (_codigoMunicipio != null && _codigoMunicipio!.isNotEmpty)
                    'codigoMunicipio': _codigoMunicipio,
```

`_cadastrar` não tem a variável `ehCnpj` (ela é local do `build`), então declarar no começo do método, logo antes de `setState(() => _enviando = true);`:

```dart
    final ehCnpjSelecionado = _tipo == 'CNPJ';
```

- [ ] **Step 8: Analisar e rodar todos os testes**

Run: `cd apps/mobile && flutter analyze && flutter test`
Expected: `No issues found!` e todos os testes passando.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/lib/features/auth/cadastro_screen.dart apps/mobile/test/widget_test.dart
git commit -m "Coleta inscricao estadual no cadastro CNPJ e o codigo do municipio do ViaCEP"
```

---

### Task 4: Resolvedor de município pela API do IBGE

**Files:**
- Create: `apps/api/src/municipios/municipios-ibge.ts`
- Create: `apps/api/src/municipios/municipios-ibge.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `normalizarNomeMunicipio(nome: string): string` e `municipiosDaUf(uf: string, fetchFn?: FetchFn): Promise<Map<string, string> | null>` — o mapa vai de nome normalizado para código IBGE em string; `null` significa **falha de rede**, distinto de um mapa vazio. A Task 5 depende dessa distinção.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/municipios/municipios-ibge.spec.ts`:

```ts
import { municipiosDaUf, normalizarNomeMunicipio } from './municipios-ibge';

describe('normalizarNomeMunicipio', () => {
  it('ignora acento, caixa e pontuacao', () => {
    expect(normalizarNomeMunicipio('São Paulo')).toBe(normalizarNomeMunicipio('SAO PAULO'));
    expect(normalizarNomeMunicipio("Santa Cruz do Capibaribe")).toBe('santacruzdocapibaribe');
    expect(normalizarNomeMunicipio("Olho d'Água")).toBe('olhodagua');
  });
});

describe('municipiosDaUf', () => {
  function resposta(body: unknown, ok = true) {
    return jest.fn(async () => ({ ok, json: async () => body })) as never;
  }

  it('indexa os municipios pelo nome normalizado', async () => {
    const mapa = await municipiosDaUf('pe', resposta([{ id: 2611606, nome: 'Recife' }, { id: 2610707, nome: 'Petrolina' }]));
    expect(mapa!.get('recife')).toBe('2611606');
    expect(mapa!.get('petrolina')).toBe('2610707');
  });

  it('chama a UF em maiusculo', async () => {
    const fetchFn = resposta([{ id: 1, nome: 'X' }]);
    await municipiosDaUf('pe', fetchFn);
    expect(String((fetchFn as unknown as jest.Mock).mock.calls[0][0])).toContain('/estados/PE/municipios');
  });

  it('devolve null quando a resposta nao e ok', async () => {
    expect(await municipiosDaUf('PE', resposta([], false))).toBeNull();
  });

  it('devolve null quando a lista vem vazia', async () => {
    expect(await municipiosDaUf('PE', resposta([]))).toBeNull();
  });

  it('devolve null quando a rede falha, sem lancar', async () => {
    const quebrado = jest.fn(async () => {
      throw new Error('ECONNRESET');
    }) as never;
    expect(await municipiosDaUf('PE', quebrado)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/api -- municipios-ibge`
Expected: FAIL — `Cannot find module './municipios-ibge'`.

- [ ] **Step 3: Escrever a implementação**

Criar `apps/api/src/municipios/municipios-ibge.ts`:

```ts
/**
 * Município → código IBGE, sem chave e sem custo, pela API de localidades do IBGE.
 *
 * O ViaCEP já devolve o código na busca de CEP do app, então este caminho só é
 * usado quando ele não veio: ViaCEP fora do ar, CEP genérico de cidade pequena,
 * ou endereço antigo que entrou no banco antes deste recurso existir.
 *
 * Nunca lança: falha de rede devolve null.
 */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const IBGE = 'https://servicodados.ibge.gov.br/api/v1/localidades/estados';
const TIMEOUT_MS = 8_000;

interface MunicipioIbge {
  id: number;
  nome: string;
}

/** "Olho d'Água" e "OLHO DAGUA" viram a mesma chave. */
export function normalizarNomeMunicipio(nome: string): string {
  return (nome ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Municípios de uma UF, indexados pelo nome normalizado.
 * `null` é falha (rede, HTTP ou lista vazia) — diferente de um mapa sem a cidade
 * procurada, que significa "o IBGE respondeu e essa cidade não existe nessa UF".
 */
export async function municipiosDaUf(uf: string, fetchFn: FetchFn = fetch): Promise<Map<string, string> | null> {
  try {
    const res = await fetchFn(`${IBGE}/${uf.trim().toUpperCase()}/municipios`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as MunicipioIbge[];
    if (!Array.isArray(body) || body.length === 0) return null;
    const mapa = new Map<string, string>();
    for (const m of body) mapa.set(normalizarNomeMunicipio(m.nome), String(m.id));
    return mapa;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/api -- municipios-ibge`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/municipios/municipios-ibge.ts apps/api/src/municipios/municipios-ibge.spec.ts
git commit -m "Resolve codigo do municipio pela API de localidades do IBGE"
```

---

### Task 5: Worker que preenche o município e faz o backfill

**Files:**
- Create: `apps/api/src/municipios/municipios.worker.ts`
- Create: `apps/api/src/municipios/municipios.worker.spec.ts`
- Create: `apps/api/src/municipios/municipios.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `municipiosDaUf` e `normalizarNomeMunicipio` (Task 4); colunas da Task 1.
- Produces: `MunicipiosWorker` com `deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean`, `processarPendentes(slug?: string): Promise<void>`, `dispararAgora(slug?: string)` e `estado()`. `MunicipiosModule` exporta o worker.

**Decisão de projeto a preservar:** falha de rede na UF **não** incrementa `municipio_tentativas`. Só incrementa quando o IBGE respondeu e a cidade não casou. Sem isso, cinco noites de rede ruim queimariam as 5 tentativas de todos os endereços daquela UF e eles nunca mais seriam tentados.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/municipios/municipios.worker.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { deveRodarAgora, MunicipiosWorker } from './municipios.worker';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('deveRodarAgora', () => {
  it('roda as 04:xx se ainda nao rodou hoje', () => {
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 0, 30), null)).toBe(true);
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 59, 0), '2026-09-21')).toBe(true);
  });

  it('nao roda fora das 04:xx nem duas vezes no mesmo dia', () => {
    // 03:xx e a janela do worker de geocodificacao: os dois nao podem coincidir.
    expect(deveRodarAgora(new Date(2026, 8, 22, 3, 30, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 22, 5, 0, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 22, 4, 10, 0), '2026-09-22')).toBe(false);
  });
});

describe('MunicipiosWorker.processarPendentes', () => {
  function montar(rows: unknown[], mapa: Map<string, string> | null) {
    const query = jest.fn(async (sql: string) => (sql.trim().startsWith('select') ? { rows } : { rows: [] }));
    const db = {
      listActiveTenantSlugs: async () => ['cahu'],
      getTenantPool: async () => ({ query }),
    };
    const municipiosDaUf = jest.fn(async () => mapa);
    const w = new MunicipiosWorker(db as never, { municipiosDaUf, esperar: async () => undefined });
    return { w, query, municipiosDaUf };
  }

  const linha = { id: 'e1', cidade: 'Petrolina', uf: 'PE' };

  it('grava o codigo quando a cidade casa', async () => {
    const { w, query } = montar([linha], new Map([['petrolina', '2610707']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set codigo_municipio'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['2610707', 'e1']);
    expect(w.estado().emAndamento).toBe(false);
  });

  it('casa ignorando acento e caixa', async () => {
    const { w, query } = montar([{ id: 'e2', cidade: 'SAO PAULO', uf: 'SP' }], new Map([['saopaulo', '3550308']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set codigo_municipio'));
    expect(update![1]).toEqual(['3550308', 'e2']);
  });

  it('incrementa tentativas quando o IBGE respondeu mas a cidade nao existe', async () => {
    const { w, query } = montar([linha], new Map([['recife', '2611606']]));
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('municipio_tentativas = municipio_tentativas + 1'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['e1']);
  });

  it('NAO incrementa tentativas quando a rede falha', async () => {
    const { w, query } = montar([linha], null);
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('municipio_tentativas = municipio_tentativas + 1'));
    expect(update).toBeUndefined();
  });

  it('busca a lista de cada UF uma vez so', async () => {
    const { w, municipiosDaUf } = montar(
      [linha, { id: 'e2', cidade: 'Recife', uf: 'PE' }, { id: 'e3', cidade: 'Petrolina', uf: 'PE' }],
      new Map([['petrolina', '2610707'], ['recife', '2611606']]),
    );
    await w.processarPendentes();
    expect(municipiosDaUf).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/api -- municipios.worker`
Expected: FAIL — `Cannot find module './municipios.worker'`.

- [ ] **Step 3: Escrever o worker**

Criar `apps/api/src/municipios/municipios.worker.ts`:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { municipiosDaUf as municipiosDaUfPadrao, normalizarNomeMunicipio } from './municipios-ibge';

const MAX_TENTATIVAS = 5;
const LOTE = 200;
const HORA_AGENDADA = 4; // 04:00 local. 03:xx é a janela da geocodificação.
const INTERVALO_MS = 1_000; // 1 req/s no IBGE
const DESLIGADO = process.env.MUNICIPIOS_DESLIGADO === 'true';

/** Regra pura da agenda: roda uma vez por dia, dentro da hora 04:xx. */
export function deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean {
  if (agora.getHours() !== HORA_AGENDADA) return false;
  return dataLocal(agora) !== ultimaDataRodada;
}

function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Deps {
  municipiosDaUf: (uf: string) => Promise<Map<string, string> | null>;
  esperar: (ms: number) => Promise<void>;
}

const depsPadrao: Deps = {
  municipiosDaUf: (uf) => municipiosDaUfPadrao(uf),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Preenche `cliente_enderecos.codigo_municipio` (IBGE) onde ele não veio do
 * ViaCEP no cadastro. Mesmo padrão do GeocodificacaoWorker: setInterval dentro
 * da API, sem fila externa. Na primeira execução faz o backfill de toda a base,
 * inclusive dos clientes que vieram do Dlinks.
 *
 * Nunca escreve no ERP; só em cliente_enderecos.
 */
@Injectable()
export class MunicipiosWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('MunicipiosWorker');
  private timer: NodeJS.Timeout | null = null;
  private emAndamento = false;
  private ultimaExecucaoEm: Date | null = null;
  private ultimaDataRodada: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly deps: Deps = depsPadrao,
  ) {}

  onModuleInit() {
    if (DESLIGADO) return;
    this.timer = setInterval(() => {
      const agora = new Date();
      if (!deveRodarAgora(agora, this.ultimaDataRodada)) return;
      this.ultimaDataRodada = dataLocal(agora);
      this.dispararAgora();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  estado() {
    return { emAndamento: this.emAndamento, ultimaExecucaoEm: this.ultimaExecucaoEm?.toISOString() ?? null };
  }

  /** Dispara em background; se já estiver rodando, não inicia outra. Sem `slug`, cobre todos os tenants. */
  dispararAgora(slug?: string): { iniciado: boolean; emAndamento: boolean } {
    if (DESLIGADO) return { iniciado: false, emAndamento: false };
    if (this.emAndamento) return { iniciado: false, emAndamento: true };
    void this.processarPendentes(slug).catch((e) => this.log.error(e));
    return { iniciado: true, emAndamento: true };
  }

  async processarPendentes(slug?: string): Promise<void> {
    if (this.emAndamento) return;
    this.emAndamento = true;
    this.ultimaDataRodada = dataLocal(new Date());
    const contagem = { processados: 0, resolvidos: 0, semCidade: 0, semLista: 0 };
    // Cache por execução: são 27 UFs no máximo, não uma requisição por endereço.
    const listas = new Map<string, Map<string, string> | null>();
    try {
      const slugs = slug ? [slug] : await this.db.listActiveTenantSlugs();
      for (const slug of slugs) {
        try {
          const pool = await this.db.getTenantPool(slug);
          const { rows } = await pool.query(
            `select id, cidade, uf from cliente_enderecos
              where codigo_municipio is null and municipio_tentativas < $1
              order by municipio_ultima_tentativa_em nulls first limit $2`,
            [MAX_TENTATIVAS, LOTE],
          );
          for (const end of rows as { id: string; cidade: string; uf: string }[]) {
            try {
              const uf = (end.uf ?? '').trim().toUpperCase();
              if (!listas.has(uf)) {
                listas.set(uf, await this.deps.municipiosDaUf(uf));
                await this.deps.esperar(INTERVALO_MS);
              }
              const lista = listas.get(uf)!;
              contagem.processados++;
              // Falha de rede não gasta tentativa: senão cinco noites ruins
              // aposentariam todos os endereços da UF para sempre.
              if (lista === null) {
                contagem.semLista++;
                continue;
              }
              const codigo = lista.get(normalizarNomeMunicipio(end.cidade ?? ''));
              if (codigo) {
                await pool.query(
                  `update cliente_enderecos
                      set codigo_municipio = $1, municipio_ultima_tentativa_em = now()
                    where id = $2`,
                  [codigo, end.id],
                );
                contagem.resolvidos++;
              } else {
                await pool.query(
                  `update cliente_enderecos
                      set municipio_tentativas = municipio_tentativas + 1, municipio_ultima_tentativa_em = now()
                    where id = $1`,
                  [end.id],
                );
                contagem.semCidade++;
              }
            } catch (e) {
              this.log.error(`municipios: falha no endereco ${slug}/${end.id}: ${e}`);
            }
          }
        } catch (e) {
          this.log.error(`municipios: falha no tenant ${slug}: ${e}`);
        }
      }
      this.log.log(
        `municipios: ${contagem.processados} processados, ${contagem.resolvidos} resolvidos, ${contagem.semCidade} sem cidade correspondente, ${contagem.semLista} sem lista do IBGE`,
      );
    } finally {
      this.emAndamento = false;
      this.ultimaExecucaoEm = new Date();
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace apps/api -- municipios.worker`
Expected: PASS, 7 testes.

- [ ] **Step 5: Registrar o módulo**

Criar `apps/api/src/municipios/municipios.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MunicipiosWorker } from './municipios.worker';

@Module({
  providers: [MunicipiosWorker],
  exports: [MunicipiosWorker],
})
export class MunicipiosModule {}
```

Em `apps/api/src/app.module.ts`, acrescentar o import junto dos outros:

```ts
import { MunicipiosModule } from './municipios/municipios.module';
```

e `MunicipiosModule` ao final da lista de `imports` do decorador `@Module`.

- [ ] **Step 6: Compilar, subir e rodar o backfill uma vez**

Run:
```bash
npm run build --workspace apps/api && npm test --workspace apps/api
```
Expected: build limpo, suíte inteira verde.

Depois, com a API rodando localmente (`npm run api`), conferir o backfill contra o banco:

```bash
psql -U postgres -d fluxo_t_cahu -c "select count(*) filter (where codigo_municipio is null) as sem, count(*) as total from cliente_enderecos"
```
Expected: registrar o número antes; após uma execução manual do worker (ou esperar a janela das 04:00), `sem` deve cair. Se o ambiente local não tiver dados, este passo é só o registro do número.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/municipios/ apps/api/src/app.module.ts
git commit -m "Worker diario que preenche o codigo do municipio e faz o backfill"
```

---

### Task 6: Inscrição Estadual opcional vinda do Dlinks

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/cliente.dto.ts`
- Modify: `apps/api/src/integracoes-dlinks/dlinks-sync.service.ts` (`syncClientes`, o `on conflict ... do update set`)
- Create: `apps/api/src/integracoes-dlinks/dlinks-sync-clientes.spec.ts`

**Interfaces:**
- Consumes: coluna `clientes.inscricao_estadual` (Task 1).
- Produces: campo `inscricao_estadual?: string` aceito em `POST /integracoes/dlinks/clientes`. A Task 9 documenta esse campo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/integracoes-dlinks/dlinks-sync-clientes.spec.ts`:

```ts
import { Logger } from '@nestjs/common';
import { DlinksSyncService } from './dlinks-sync.service';
import { runComTenant } from '../tenancy/tenant-context';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

const clienteBase = {
  codigo: '00123',
  razao_social: 'Mercado Exemplo LTDA',
  cnpj_cpf: '12.345.678/0001-90',
  endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Petrolina', uf: 'PE', cep: '56302000' },
};

function montar() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('insert into clientes')) return { rows: [{ id: 'c1', inserido: false }] };
    return { rows: [{ '?column?': 1 }] }; // credencial já existe
  });
  const servico = new DlinksSyncService();
  return { servico, query, pool: { query } };
}

async function sincronizar(servico: DlinksSyncService, pool: unknown, itens: unknown[]) {
  // TenantContext é { tenant, pool }; o `tenant` não é lido por syncClientes.
  await runComTenant({ tenant: {}, pool } as never, () => servico.syncClientes(itens as never));
}

describe('syncClientes e a inscricao estadual', () => {
  it('usa coalesce para nao apagar a IE que o cliente digitou no app', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [clienteBase]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(String(insert![0])).toContain('inscricao_estadual = coalesce(excluded.inscricao_estadual, clientes.inscricao_estadual)');
  });

  it('manda null quando o Dlinks nao envia o campo', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [clienteBase]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(insert![1]).toContain(null);
  });

  it('grava a IE quando o Dlinks envia', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [{ ...clienteBase, inscricao_estadual: '0612345-6' }]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(insert![1]).toContain('06123456');
  });
});
```

> `DlinksSyncService` não declara construtor, então `new DlinksSyncService()` basta. O `pool` falso cobre também o `insert into integracao_logs` que `registrarLog` dispara no fim do sync.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace apps/api -- dlinks-sync-clientes`
Expected: FAIL — o SQL não contém `inscricao_estadual`.

- [ ] **Step 3: Adicionar o campo ao DTO**

Em `apps/api/src/integracoes-dlinks/cliente.dto.ts`, no fim de `ClienteDto`:

```ts
  /** Inscrição Estadual do cliente no ERP. Opcional: ausente nunca apaga a IE já gravada. */
  @IsOptional()
  @IsString()
  inscricao_estadual?: string;
```

- [ ] **Step 4: Gravar com coalesce no sync**

Em `apps/api/src/integracoes-dlinks/dlinks-sync.service.ts`, dentro de `syncClientes`, logo depois da linha que calcula `email`:

```ts
        const inscricaoEstadual = (item.inscricao_estadual ?? '').replace(/\D/g, '') || null;
```

Trocar o insert por (o `$9` novo entra antes do `tabela_preco_id`, que passa a ser `$10` — conferir **todas** as referências a `$8` no trecho):

```ts
          `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, status, erp_cliente_id, limite_credito, saldo_titulos_aberto, codigo_indicacao, tabela_preco_id, inscricao_estadual)
           values ($1, $2, $3, $3, $4, 'aprovado', $5, $6, $7, upper(substring(md5(random()::text) from 1 for 6)),
                   (select id from tabelas_preco where erp_tabela_id = $8), $9)
           on conflict (documento) do update set
             razao_social = excluded.razao_social,
             email = coalesce(excluded.email, clientes.email),
             erp_cliente_id = excluded.erp_cliente_id,
             limite_credito = excluded.limite_credito,
             saldo_titulos_aberto = excluded.saldo_titulos_aberto,
             inscricao_estadual = coalesce(excluded.inscricao_estadual, clientes.inscricao_estadual),
             tabela_preco_id = case when $8::text is null then clientes.tabela_preco_id else coalesce(excluded.tabela_preco_id, clientes.tabela_preco_id) end
           returning id, (xmax = 0) as inserido`,
          [tipo, documento, item.razao_social, email, item.codigo, item.limite_credito ?? null, item.saldo_titulos_aberto ?? null, item.tabela_preco_id ?? null, inscricaoEstadual],
```

O `coalesce` é o ponto todo da task: uma sincronização sem o campo **não pode** apagar a IE que o cliente digitou no app.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test --workspace apps/api -- dlinks-sync-clientes`
Expected: PASS, 3 testes.

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm run build --workspace apps/api && npm test --workspace apps/api`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integracoes-dlinks/
git commit -m "Aceita inscricao estadual opcional do Dlinks sem apagar a do app"
```

---

### Task 7: Endpoint da Ficha do cliente

**Files:**
- Modify: `apps/api/src/admin/admin.service.ts` (novo método `fichaCliente`, junto do método `clientes`)
- Modify: `apps/api/src/admin/admin.controller.ts` (nova rota, junto das outras de `clientes`)

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `GET /v1/admin/clientes/:id/ficha` devolvendo exatamente:

```ts
{
  id: string; tipo: 'CPF' | 'CNPJ'; documento: string;
  razao_social: string | null; nome_fantasia: string; inscricao_estadual: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null;
  codigo_municipio: string | null; municipio_tentativas: number | null;
}
```

A Task 8 consome esses nomes de campo exatamente como estão (snake_case, direto do Postgres).

- [ ] **Step 1: Escrever o método no service**

Em `apps/api/src/admin/admin.service.ts`, depois do método `clientes`:

```ts
  /**
   * Dados que o operador precisa para cadastrar o cliente no ERP: bloco fiscal
   * e endereço padrão. `codigo_municipio` pode vir null enquanto o worker de
   * municípios não resolveu — a tela mostra isso como pendência, não como vazio.
   */
  async fichaCliente(id: string) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select c.id, c.tipo, c.documento, c.razao_social, c.nome_fantasia, c.inscricao_estadual,
              e.cep, e.logradouro, e.numero, e.complemento, e.bairro, e.cidade, e.uf,
              e.codigo_municipio, e.municipio_tentativas
         from clientes c
         left join lateral (
           select * from cliente_enderecos ce
            where ce.cliente_id = c.id
            order by ce.padrao desc limit 1
         ) e on true
        where c.id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Cliente nao encontrado');
    return rows[0];
  }
```

Conferir se `NotFoundException` já está no import de `@nestjs/common` no topo do arquivo; se não estiver, acrescentar.

- [ ] **Step 2: Expor a rota**

Em `apps/api/src/admin/admin.controller.ts`, logo depois do método `clientes(...)`:

```ts
  @Get('clientes/:id/ficha')
  fichaCliente(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.fichaCliente(id);
  }
```

- [ ] **Step 3: Compilar**

Run: `npm run build --workspace apps/api`
Expected: build sem erro.

- [ ] **Step 4: Testar o endpoint contra o banco local**

Com a API rodando (`npm run api`), pegar um id e um token válidos e chamar:

```bash
psql -U postgres -d fluxo_t_cahu -c "select id from clientes limit 1"
curl -s -H "X-Tenant: cahu" -H "Authorization: Bearer <TOKEN_ADMIN>" \
  http://localhost:3000/v1/admin/clientes/<ID>/ficha
```
Expected: JSON com as chaves listadas no bloco Interfaces. Cliente sem endereço devolve os campos de endereço como `null`, sem erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/admin.service.ts apps/api/src/admin/admin.controller.ts
git commit -m "Endpoint da ficha do cliente com dados fiscais e endereco"
```

---

### Task 8: Modal "Ficha" na Retaguarda

**Files:**
- Create: `apps/admin/src/FichaCliente.tsx`
- Modify: `apps/admin/src/paginas/Clientes.tsx`
- Modify: `apps/admin/src/index.css`

**Interfaces:**
- Consumes: `GET /admin/clientes/:id/ficha` (Task 7), via o helper `api` de `apps/admin/src/api.ts`.
- Produces: nada consumido por outra task.

- [ ] **Step 1: Escrever o componente**

Criar `apps/admin/src/FichaCliente.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, fmtDocumento } from './api';

interface Ficha {
  id: string;
  tipo: string;
  documento: string;
  razao_social: string | null;
  nome_fantasia: string;
  inscricao_estadual: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  codigo_municipio: string | null;
  municipio_tentativas: number | null;
}

/** Linha "rótulo + valor + copiar". Valor ausente não ganha botão de copiar. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (!valor) return;
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1200);
    } catch {
      // Navegador sem permissão de área de transferência: o valor continua na tela para copiar à mão.
    }
  }

  return (
    <div className="ficha-linha">
      <span className="ficha-rotulo">{rotulo}</span>
      <span className="ficha-valor">{valor ?? '—'}</span>
      {valor && (
        <button className="btn-mini" onClick={copiar} title={`Copiar ${rotulo}`}>
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      )}
    </div>
  );
}

export function FichaCliente({ id, onFechar }: { id: string; onFechar: () => void }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<Ficha>(`/admin/clientes/${id}/ficha`).then(setFicha).catch((e) => setErro((e as Error).message));
  }, [id]);

  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [onFechar]);

  const municipioTexto = ficha?.codigo_municipio
    ? `${ficha.codigo_municipio} · ${ficha.cidade ?? ''}/${ficha.uf ?? ''}`
    : null;

  const logradouro = ficha?.logradouro
    ? [ficha.logradouro, ficha.numero, ficha.complemento].filter(Boolean).join(', ')
    : null;

  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <strong>Ficha — {ficha?.nome_fantasia ?? '…'}</strong>
          <button className="btn-mini" onClick={onFechar}>Fechar</button>
        </div>

        {erro && <div className="erro-texto">{erro}</div>}
        {!ficha && !erro && <div className="vazio">Carregando…</div>}

        {ficha && (
          <>
            <div className="ficha-bloco">DADOS FISCAIS</div>
            <Campo rotulo={ficha.tipo === 'CNPJ' ? 'CNPJ' : 'CPF'} valor={fmtDocumento(ficha.documento)} />
            {ficha.tipo === 'CNPJ' && <Campo rotulo="Razão social" valor={ficha.razao_social} />}
            <Campo rotulo="Nome fantasia" valor={ficha.nome_fantasia} />
            {ficha.tipo === 'CNPJ' && <Campo rotulo="Inscrição Estadual" valor={ficha.inscricao_estadual} />}
            <div className="ficha-linha">
              <span className="ficha-rotulo">Cód. município</span>
              <span className="ficha-valor">{municipioTexto ?? '— (buscando)'}</span>
              {ficha.codigo_municipio && (
                <button
                  className="btn-mini"
                  onClick={() => navigator.clipboard.writeText(ficha.codigo_municipio!)}
                  title="Copiar código do município"
                >
                  Copiar
                </button>
              )}
            </div>

            <div className="ficha-bloco">ENDEREÇO</div>
            <Campo rotulo="CEP" valor={ficha.cep} />
            <Campo rotulo="Logradouro" valor={logradouro} />
            <Campo rotulo="Bairro" valor={ficha.bairro} />
            <Campo rotulo="Cidade/UF" valor={ficha.cidade ? `${ficha.cidade}/${ficha.uf ?? ''}` : null} />
          </>
        )}
      </div>
    </div>
  );
}
```

> `municipio_tentativas` vem no payload mas não é exibido: a tela mostra `— (buscando)` em qualquer caso em que o código não exista. O campo fica disponível caso mais tarde se queira diferenciar "ainda tentando" de "desistiu depois de 5 tentativas".

- [ ] **Step 2: Estilos**

Em `apps/admin/src/index.css`, no fim do arquivo:

```css
/* Modal (Ficha do cliente) */
.modal-fundo { position: fixed; inset: 0; background: rgb(16 24 40 / 0.45); display: flex; align-items: center; justify-content: center; padding: 16px; z-index: 50; }
.modal { background: var(--card); border: 1px solid var(--borda); border-radius: var(--raio); box-shadow: 0 10px 30px rgb(16 24 40 / 0.2); width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto; padding: 16px; }
.modal-cab { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.ficha-bloco { font-size: 11.5px; font-weight: 700; letter-spacing: 0.04em; color: var(--texto-2); margin: 14px 0 6px; }
.ficha-linha { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--borda); }
.ficha-rotulo { width: 130px; flex: none; color: var(--texto-2); font-size: 12.5px; }
.ficha-valor { flex: 1; font-family: ui-monospace, Consolas, monospace; word-break: break-word; }
```

- [ ] **Step 3: Ligar o botão na página de Clientes**

Em `apps/admin/src/paginas/Clientes.tsx`:

Acrescentar o import:

```tsx
import { FichaCliente } from '../FichaCliente';
```

Acrescentar o estado junto dos outros `useState` do componente `Clientes`:

```tsx
  const [fichaId, setFichaId] = useState<string | null>(null);
```

Na coluna de Ações, como **primeiro** filho do `<div className="acoes">` (introduzido no commit `f613331`, que trocou o fragmento antigo com separadores `{' '}` por um flex — não reintroduzir os `{' '}`, o espaçamento agora é `gap` do CSS):

```tsx
                      <button className="btn-mini" onClick={() => setFichaId(c.id)}>Ficha</button>
```

> A tabela passou a usar `table-layout: fixed` com um `colgroup` de 8 larguras percentuais no mesmo commit. Por isso o botão entra na coluna que já existe e **nenhuma coluna nova é adicionada** — acrescentar uma exigiria refazer o `colgroup` inteiro.

Antes do `</>` final do `return` do componente (junto do `<Paginacao …/>`):

```tsx
      {fichaId && <FichaCliente id={fichaId} onFechar={() => setFichaId(null)} />}
```

- [ ] **Step 4: Rodar lint e build**

Run: `npm run lint --workspace apps/admin && npm run build --workspace apps/admin`
Expected: sem erro.

- [ ] **Step 5: Conferir na tela**

Run: `npm run admin` e abrir Clientes no navegador.
Expected: o botão `Ficha` abre o modal; Esc e o clique fora fecham; `Copiar` troca para `Copiado` por um instante; cliente sem código de município mostra `— (buscando)`; cliente CPF não mostra Razão social nem IE.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/FichaCliente.tsx apps/admin/src/paginas/Clientes.tsx apps/admin/src/index.css
git commit -m "Ficha do cliente na retaguarda com dados fiscais e endereco"
```

---

### Task 9: Documentar o campo novo no handoff do Dlinks

**Files:**
- Modify: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\01 - Documentação\03-INTEGRACAO-DLINKS-HANDOFF.html` (tabela e exemplo do `POST .../clientes`, por volta das linhas 290-320)
- Create: backups datados `03-INTEGRACAO-DLINKS-HANDOFF.bak-20260922.html` e `.bak-20260922.pdf` na mesma pasta

Este arquivo fica **fora do repositório** e não entra em commit.

**Interfaces:**
- Consumes: o campo aceito na Task 6.
- Produces: nada.

- [ ] **Step 1: Fazer o backup datado**

Run:
```bash
cd "/c/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/01 - Documentação"
cp 03-INTEGRACAO-DLINKS-HANDOFF.html 03-INTEGRACAO-DLINKS-HANDOFF.bak-20260922.html
cp 03-INTEGRACAO-DLINKS-HANDOFF.pdf  03-INTEGRACAO-DLINKS-HANDOFF.bak-20260922.pdf
```

- [ ] **Step 2: Acrescentar a linha na tabela**

Na tabela do endpoint `POST .../clientes`, logo depois da linha `<tr><td><code>tabela_preco_id</code>…</tr>`:

```html
    <tr><td><code>inscricao_estadual</code></td><td class="opt">Opcional</td><td><b>Novo (22/09/2026).</b> Inscrição Estadual do cliente. Aceita com ou sem pontuação. Quando <b>não vem</b>, a IE já gravada é mantida — nunca é apagada. Serve para completar o cadastro de quem foi criado pelo Dlinks: quem se cadastra pelo app já informa a IE (ou marca isento, gravado como <code>ISENTO</code>)</td></tr>
```

- [ ] **Step 3: Acrescentar ao exemplo de payload**

No `<pre>` do exemplo, depois de `"tabela_preco_id": "14"`, trocando a vírgula da linha anterior:

```
  "tabela_preco_id": "14",
  "inscricao_estadual": "0612345-6"
```

- [ ] **Step 4: Regerar o PDF**

Abrir o HTML atualizado no navegador e imprimir para PDF sobre `03-INTEGRACAO-DLINKS-HANDOFF.pdf`, do mesmo jeito que as versões anteriores foram geradas.

Expected: o PDF novo contém a linha `inscricao_estadual` na tabela de clientes.

- [ ] **Step 5: Conferir a regra de sigilo**

Run:
```bash
cd "/c/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/01 - Documentação"
grep -i "sb vendas\|softbuilder" 03-INTEGRACAO-DLINKS-HANDOFF.html
```
Expected: nenhum resultado. Este documento é externo e não pode nomear SB Vendas nem SoftBuilder.

- [ ] **Step 6: Avisar o Tiago**

Não há commit nesta task. Reportar que o handoff foi atualizado e que o pedido ao Dlinks pode ir junto com o `tabela_preco_id` no `/clientes`, que já está pendente.

---

## Verificação final

- [ ] `npm test --workspace apps/api` — suíte inteira verde
- [ ] `npm run build --workspaces --if-present` — tudo compila
- [ ] `cd apps/mobile && flutter analyze && flutter test` — sem issues, testes verdes
- [ ] Cadastro real pelo app em modo CNPJ: IE obrigatória, isento funciona, e `select inscricao_estadual, codigo_municipio from clientes c join cliente_enderecos e on e.cliente_id = c.id order by c.criado_em desc limit 1` mostra os dois preenchidos
- [ ] Cadastro real em modo CPF: nenhum campo de IE aparece e `inscricao_estadual` fica null
- [ ] Ficha na Retaguarda mostra os dois campos e os botões de copiar funcionam
