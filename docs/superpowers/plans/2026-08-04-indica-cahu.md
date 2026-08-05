# Indica CAHU (programa de indicação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Programa de indicação no CAHU Delivery — cliente indica outro, ganha R$100 de saldo na
Carteira quando o indicado fatura o primeiro pedido.

**Architecture:** Sem tabela nova — 3 colunas em `clientes` cobrem o ciclo de vida inteiro
(código próprio, quem indicou, quando foi creditado). Geração de código no cadastro (backend,
transação existente). Crédito automático plugado no `OutboxWorker.sincronizarStatus` (já roda a
cada 30s e já detecta transição de status — só adiciona um gancho na transição pra `FATURADO`).
Link de convite é uma página pública sem autenticação na própria retaguarda React (sem deep link
de verdade — ver spec).

**Tech Stack:** NestJS 10, PostgreSQL (SQL cru via `tenantCtx().pool`), React 18 + Vite + React
Router, Flutter/Dart.

## Global Constraints

- Ver spec completa em `docs/superpowers/specs/2026-08-04-indica-cahu-design.md` — este plano
  assume que ela já foi lida.
- Valor da recompensa: **R$100 fixo** (não configurável pela retaguarda nesta v1).
- Gatilho do crédito: só quando o pedido do indicado chega a `FATURADO` — nunca no cadastro nem
  na aprovação. Dispara uma única vez por indicado (`indicacao_creditada_em` funciona como lock).
- Sem deep link — o link de convite abre uma página web simples (a retaguarda já hospedada serve
  isso), nunca tenta abrir o app automaticamente.
- Este projeto não usa testes automatizados — verificação é manual (`curl`, `psql`, Chrome
  DevTools, `flutter analyze`).
- Migração vai em `infra/sql/tenant` (versionado no repo) **e** espelhada em
  `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant` (pasta fora do repo) —
  conteúdo idêntico nos dois.
- Senha do Postgres de dev: `postgres`, host `localhost`, porta `5432`, banco `fluxo_t_cahu`.
  `psql` fica em `C:\Program Files\PostgreSQL\16\bin\psql.exe` nesta máquina.
- Admin dev login: `admin@cahu.com.br` / `cahu@2026`.
- Depois de cada verificação com dados de teste, limpe o que criou (mesmo padrão já usado nas
  outras features do projeto).

---

### Task 1: Migração — colunas de indicação em `clientes`

**Files:**
- Create: `infra/sql/tenant/013_indicacoes.sql`
- Create: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\013_indicacoes.sql` (idêntico)

**Interfaces:**
- Produz: `clientes.codigo_indicacao` (text, unique, not null após backfill),
  `clientes.indicado_por_cliente_id` (uuid, FK pra `clientes`), `clientes.indicacao_creditada_em`
  (timestamptz, nullable) — consumidos por todas as tasks seguintes.

- [ ] **Step 1: Criar a migração**

Crie `infra/sql/tenant/013_indicacoes.sql`:

```sql
-- Indica CAHU (benchmark Praso, 04/08/2026): programa de indicação. Sem
-- tabela nova — codigo_indicacao é o código do próprio cliente pra indicar
-- outros; indicado_por_cliente_id é preenchido uma vez, no cadastro do
-- indicado; indicacao_creditada_em funciona como lock (garante que o
-- crédito de R$100 dispara uma única vez, na transição do pedido do
-- indicado pra FATURADO — ver OutboxWorker.sincronizarStatus).
alter table clientes add column if not exists codigo_indicacao text unique;
alter table clientes add column if not exists indicado_por_cliente_id uuid references clientes(id);
alter table clientes add column if not exists indicacao_creditada_em timestamptz;

-- Backfill: clientes cadastrados antes desta migração não têm código —
-- gera um código de 6 caracteres derivado do próprio id (determinístico o
-- suficiente pra não colidir, não precisa de retry aqui como no cadastro).
update clientes set codigo_indicacao = upper(substring(md5(random()::text || id::text) from 1 for 6))
where codigo_indicacao is null;

alter table clientes alter column codigo_indicacao set not null;

insert into schema_migrations (versao) values ('013') on conflict do nothing;
```

- [ ] **Step 2: Espelhar em `11 - SQL`**

Copie o mesmo conteúdo pra
`C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\11 - SQL\tenant\013_indicacoes.sql`.

- [ ] **Step 3: Aplicar no banco de dev**

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -f infra/sql/tenant/013_indicacoes.sql
```

Expected: `ALTER TABLE` (x3), `UPDATE N` (N = quantidade de clientes já cadastrados no banco de
dev), `ALTER TABLE`, `INSERT 0 1`.

- [ ] **Step 4: Verificar**

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select id, codigo_indicacao, indicado_por_cliente_id, indicacao_creditada_em from clientes limit 5"
```

Expected: toda linha tem `codigo_indicacao` preenchido (6 caracteres), `indicado_por_cliente_id`
e `indicacao_creditada_em` nulos (nenhum cliente existente foi indicado por ninguém).

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select count(distinct codigo_indicacao) as distintos, count(*) as total from clientes"
```

Expected: `distintos` igual a `total` (nenhuma colisão no backfill).

- [ ] **Step 5: Commit**

```bash
git add infra/sql/tenant/013_indicacoes.sql
git commit -m "feat(db): colunas de indicacao em clientes (codigo, indicado_por, creditada_em)"
```

---

### Task 2: Backend — cadastro gera código e aceita `codigoIndicacao`

**Files:**
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.service.ts`

**Interfaces:**
- Consome: `clientes.codigo_indicacao`/`indicado_por_cliente_id` (Task 1).
- Produz: `POST /auth/registrar` aceita `codigoIndicacao?: string` no body; todo cliente novo sai
  do cadastro com `codigo_indicacao` preenchido — consumido pelas Tasks 5, 6, 7.

- [ ] **Step 1: Aceitar o campo no DTO**

Em `apps/api/src/auth/auth.controller.ts`, troque a classe `RegistrarDto` (linhas 5-14):

```typescript
class RegistrarDto {
  @IsIn(['CPF', 'CNPJ']) tipo!: 'CPF' | 'CNPJ';
  @IsNotEmpty() documento!: string;
  @IsNotEmpty() nomeFantasia!: string;
  @IsOptional() @IsString() razaoSocial?: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() categoria?: string;
  @MinLength(6) senha!: string;
}
```

por:

```typescript
class RegistrarDto {
  @IsIn(['CPF', 'CNPJ']) tipo!: 'CPF' | 'CNPJ';
  @IsNotEmpty() documento!: string;
  @IsNotEmpty() nomeFantasia!: string;
  @IsOptional() @IsString() razaoSocial?: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telefone?: string;
  @IsOptional() @IsString() categoria?: string;
  @MinLength(6) senha!: string;
  @IsOptional() @IsString() codigoIndicacao?: string;
}
```

(`IsString`/`IsOptional` já estão importados no topo do arquivo — nenhum import novo aqui.)

- [ ] **Step 2: Gerar código e validar indicação em `auth.service.ts`**

Troque o import do topo do arquivo (linha 1):

```typescript
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
```

por:

```typescript
import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
```

Troque a assinatura de `registrar` (linhas 18-30):

```typescript
  async registrar(
    dados: {
      tipo: 'CPF' | 'CNPJ';
      documento: string;
      nomeFantasia: string;
      razaoSocial?: string;
      email: string;
      telefone?: string;
      categoria?: string;
      senha: string;
    },
    deviceId?: string,
  ) {
```

por:

```typescript
  async registrar(
    dados: {
      tipo: 'CPF' | 'CNPJ';
      documento: string;
      nomeFantasia: string;
      razaoSocial?: string;
      email: string;
      telefone?: string;
      categoria?: string;
      senha: string;
      codigoIndicacao?: string;
    },
    deviceId?: string,
  ) {
```

Dentro do bloco `try` (depois do `if (dup.rowCount) throw ...` na linha 41, antes do
`insert into clientes`), adicione a validação do código e a geração do código próprio:

```typescript
      if (dup.rowCount) throw new ConflictException('Documento ou e-mail já cadastrado');
      let indicadoPorClienteId: string | null = null;
      if (dados.codigoIndicacao) {
        const ind = await client.query(`select id from clientes where codigo_indicacao = $1`, [
          dados.codigoIndicacao.trim().toUpperCase(),
        ]);
        if (!ind.rows[0]) throw new BadRequestException('Código de indicação inválido');
        indicadoPorClienteId = ind.rows[0].id;
      }
      const codigoIndicacao = await this.gerarCodigoIndicacao(client);
      const { rows } = await client.query(
        `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, telefone, categoria, codigo_indicacao, indicado_por_cliente_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, status`,
        [
          dados.tipo,
          doc,
          dados.razaoSocial ?? null,
          dados.nomeFantasia,
          dados.email.toLowerCase(),
          dados.telefone ?? null,
          dados.categoria ?? null,
          codigoIndicacao,
          indicadoPorClienteId,
        ],
      );
```

(Isso substitui o bloco `const { rows } = await client.query(...)` que já existia logo depois do
`if (dup.rowCount)` — mesma query, só com duas colunas/parâmetros novos.)

Adicione o método privado `gerarCodigoIndicacao`, depois do fechamento de `registrar` (antes do
método `login`):

```typescript
  /** 6 caracteres, sem 0/O/1/I (evita confusão visual) — retry em caso de colisão rara. */
  private async gerarCodigoIndicacao(client: import('pg').PoolClient): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      let codigo = '';
      for (let i = 0; i < 6; i++) codigo += chars[Math.floor(Math.random() * chars.length)];
      const existe = await client.query(`select 1 from clientes where codigo_indicacao = $1`, [codigo]);
      if (!existe.rowCount) return codigo;
    }
    throw new Error('Não foi possível gerar código de indicação único');
  }
```

- [ ] **Step 3: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: sem erro de build/inicialização.

- [ ] **Step 4: Verificar com curl**

Cadastro sem código (fluxo normal, não pode quebrar):

```bash
curl -s -X POST http://localhost:3000/v1/auth/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" \
  -d '{"tipo":"CPF","documento":"12345678909","nomeFantasia":"Teste Indicacao A","email":"teste.indicacaoA@example.com","senha":"teste12345"}'
```

Expected: `201`/JSON com `clienteId`. Confirme que ganhou código:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select codigo_indicacao, indicado_por_cliente_id from clientes where email = 'teste.indicacaoa@example.com'"
```

Expected: `codigo_indicacao` preenchido (6 chars), `indicado_por_cliente_id` nulo. **Guarde esse
`codigo_indicacao`** pro próximo teste.

Cadastro com código válido (substitua `CODIGO_A` pelo valor real obtido acima):

```bash
curl -s -X POST http://localhost:3000/v1/auth/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" \
  -d '{"tipo":"CPF","documento":"98765432100","nomeFantasia":"Teste Indicacao B","email":"teste.indicacaoB@example.com","senha":"teste12345","codigoIndicacao":"CODIGO_A"}'
```

Expected: `201`. Confirme o vínculo:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select b.nome_fantasia, a.nome_fantasia as indicador from clientes b join clientes a on a.id = b.indicado_por_cliente_id where b.email = 'teste.indicacaob@example.com'"
```

Expected: 1 linha, `indicador` = "Teste Indicacao A".

Cadastro com código inválido:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/v1/auth/registrar -H "X-Tenant: cahu" -H "Content-Type: application/json" \
  -d '{"tipo":"CPF","documento":"11111111111","nomeFantasia":"Teste Codigo Invalido","email":"teste.codigoinvalido@example.com","senha":"teste12345","codigoIndicacao":"ZZZZZZ"}'
```

Expected: `400`.

Limpe os 2 clientes de teste criados (A e B) — `carteira_movimentos`/`favoritos`/
`solicitacoes_credito` where cliente_id, depois `cliente_credenciais`, `refresh_tokens`,
`clientes` (nessa ordem).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.service.ts
git commit -m "feat(api): cadastro gera codigo de indicacao e aceita codigoIndicacao"
```

---

### Task 3: Backend — proteger `excluirCliente` contra indicações feitas

**Files:**
- Modify: `apps/api/src/admin/admin.service.ts`

**Interfaces:**
- Consome: `clientes.indicado_por_cliente_id` (Task 1).

**Por quê:** `indicado_por_cliente_id` é uma FK pra `clientes(id)`. Se um cliente X indicou
alguém (outro cliente Y tem `Y.indicado_por_cliente_id = X.id`) e X **não** tem pedido nem
carteira nem crédito solicitado, `excluirCliente` hoje tentaria apagar X de verdade — e isso
quebra com violação de FK, exatamente como já aconteceu com `carteira_movimentos` nesta mesma
sessão (ver commit `cde7053`). Corrigir agora, antes de existir dado de verdade que dispare isso.

- [ ] **Step 1: Somar a checagem em `preservarCliente`**

Em `apps/api/src/admin/admin.service.ts`, troque (dentro de `excluirCliente`):

```typescript
    const temPedido = await pool.query(`select 1 from pedidos where cliente_id = $1 limit 1`, [id]);
    const temCarteira = await pool.query(`select 1 from carteira_movimentos where cliente_id = $1 limit 1`, [id]);
    const preservarCliente = temPedido.rowCount || temCarteira.rowCount;
```

por:

```typescript
    const temPedido = await pool.query(`select 1 from pedidos where cliente_id = $1 limit 1`, [id]);
    const temCarteira = await pool.query(`select 1 from carteira_movimentos where cliente_id = $1 limit 1`, [id]);
    const temIndicados = await pool.query(`select 1 from clientes where indicado_por_cliente_id = $1 limit 1`, [id]);
    const preservarCliente = temPedido.rowCount || temCarteira.rowCount || temIndicados.rowCount;
```

- [ ] **Step 2: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: sem erro.

- [ ] **Step 3: Verificar com curl**

Cadastre um cliente A (sem pedido/carteira), depois um cliente B usando o código de A (mesmo
padrão da Task 2), depois tente excluir A pela retaguarda:

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/v1/admin/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"email":"admin@cahu.com.br","senha":"cahu@2026"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
curl -s -X DELETE http://localhost:3000/v1/admin/clientes/<ID_DO_CLIENTE_A> -H "X-Tenant: cahu" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `{"ok":true,"removidoDeVerdade":false}` (preservado/anonimizado, **sem erro 500**).
Confirme que B ainda existe e ainda referencia A:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select nome_fantasia, status, indicado_por_cliente_id from clientes where indicado_por_cliente_id is not null"
```

Expected: B aparece com `indicado_por_cliente_id` ainda apontando pro id de A (A não sumiu,
só foi anonimizado). Limpe os dois clientes de teste ao final (via SQL direto, já que A está
anonimizado — apagar por id direto: `delete from clientes where id in (...)` depois de limpar as
tabelas dependentes, mesmo padrão dos scripts de limpeza já usados nesta sessão).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/admin/admin.service.ts
git commit -m "fix(api): excluirCliente preserva quem ja indicou alguem (evita FK violation)"
```

---

### Task 4: Backend — crédito automático em `sincronizarStatus`

**Files:**
- Modify: `apps/api/src/orders/outbox.worker.ts`

**Interfaces:**
- Consome: `clientes.indicado_por_cliente_id`/`indicacao_creditada_em` (Task 1),
  `carteira_movimentos` (já existe, ver plano da Carteira).
- Produz: crédito de R$100 automático — consumido pelas Tasks 5 e 6 (extrato/fila mostram o
  resultado).

- [ ] **Step 1: Adicionar o método `creditarIndicacao`**

Em `apps/api/src/orders/outbox.worker.ts`, adicione, depois do fechamento do método
`sincronizarStatus` (antes do método `logar`):

```typescript
  /**
   * Credita R$100 na carteira de quem indicou, na primeira vez que o pedido
   * do indicado chega a FATURADO. indicacao_creditada_em funciona como lock
   * — garante que isso dispara uma única vez por indicado, não importa
   * quantos pedidos ele faça depois nem quantas vezes o status for
   * resincronizado.
   */
  private async creditarIndicacao(pool: import('pg').Pool, pedidoId: string) {
    const { rows } = await pool.query(
      `select c.id as indicado_id, c.nome_fantasia as indicado_nome, c.indicado_por_cliente_id
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.id = $1 and c.indicado_por_cliente_id is not null and c.indicacao_creditada_em is null`,
      [pedidoId],
    );
    const r = rows[0];
    if (!r) return;
    await pool.query(`insert into carteira_movimentos (cliente_id, valor, motivo) values ($1, 100, $2)`, [
      r.indicado_por_cliente_id,
      `Indicação: ${r.indicado_nome}`,
    ]);
    await pool.query(`update clientes set indicacao_creditada_em = now() where id = $1`, [r.indicado_id]);
  }
```

- [ ] **Step 2: Chamar no ponto certo de `sincronizarStatus`**

Troque o bloco (dentro de `sincronizarStatus`):

```typescript
          if (st.status !== p.status) {
            await pool.query(`update pedidos set status = $2 where id = $1`, [p.id, st.status]);
            await pool.query(
              `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'erp')`,
              [p.id, st.status, st.detalhe ?? null],
            );
          }
```

por:

```typescript
          if (st.status !== p.status) {
            await pool.query(`update pedidos set status = $2 where id = $1`, [p.id, st.status]);
            await pool.query(
              `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'erp')`,
              [p.id, st.status, st.detalhe ?? null],
            );
            if (st.status === 'FATURADO') {
              await this.creditarIndicacao(pool, p.id);
            }
          }
```

- [ ] **Step 3: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: sem erro.

- [ ] **Step 4: Verificar com curl (fluxo completo, esperando o worker)**

Cadastre cliente A (indicador), pegue o `codigo_indicacao` dele, cadastre cliente B com esse
código (mesmo padrão da Task 2). Logue como B, monte um carrinho pequeno, crie endereço, feche
um pedido (`POST /pedidos`, mesmo roteiro já usado nas verificações da Carteira). Espere ~40s (o
`sincronizarStatus` roda a cada 30s e o mock só fatura depois de 15s do envio ao ERP):

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select status from pedidos where id = '<PEDIDO_ID>'"
```

Repita até `status = FATURADO`. Depois:

```bash
PGPASSWORD=postgres "/c/Program Files/PostgreSQL/16/bin/psql.exe" -h localhost -U postgres -d fluxo_t_cahu -c "select indicacao_creditada_em from clientes where id = '<ID_CLIENTE_B>'"
curl -s http://localhost:3000/v1/carteira -H "X-Tenant: cahu" -H "Authorization: Bearer <TOKEN_DO_CLIENTE_A>"
```

Expected: `indicacao_creditada_em` preenchido; a carteira de A mostra `saldo: 100` com um
movimento `"Indicação: Teste Indicacao B"` (ou o nome usado no cadastro de B).

Limpe os clientes de teste e o pedido ao final (mesma ordem já usada: `pedido_cobrancas` →
`pedido_notas` → `pedido_eventos` → `sync_outbox` → `pedido_itens` → `pedidos` →
`carteira_movimentos` → resto de `clientes`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/orders/outbox.worker.ts
git commit -m "feat(api): credita R\$100 na carteira de quem indicou quando o indicado fatura"
```

---

### Task 5: Backend — `GET /v1/indicacoes` (cliente)

**Files:**
- Modify: `apps/api/src/profile/profile.controller.ts`

**Interfaces:**
- Consome: `clientes.codigo_indicacao`/`indicado_por_cliente_id`/`indicacao_creditada_em`
  (Task 1).
- Produz: `GET /v1/indicacoes` → `{ codigo: string, link: string, indicacoes: Array<{nome,
  status: 'pendente'|'creditado', criado_em, creditado_em}> }` (mesma convenção `snake_case` já
  usada em `carteira()`/`credito()` neste arquivo) — consumido pela Task 7 (`IndicacoesScreen`).

- [ ] **Step 1: Adicionar o endpoint**

Em `apps/api/src/profile/profile.controller.ts`, logo antes do fechamento da classe
`ProfileController` (depois do método `carteira`, antes do `}` final), adicione:

```typescript

  @Get('indicacoes')
  async indicacoes(@Req() req: ReqCliente) {
    const { pool } = tenantCtx();
    const cli = await pool.query(`select codigo_indicacao from clientes where id = $1`, [req.cliente.clienteId]);
    const { rows } = await pool.query(
      `select nome_fantasia as nome, criado_em, indicacao_creditada_em
         from clientes where indicado_por_cliente_id = $1 order by criado_em desc`,
      [req.cliente.clienteId],
    );
    const base = process.env.PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
    return {
      codigo: cli.rows[0].codigo_indicacao,
      link: `${base}/indica/${cli.rows[0].codigo_indicacao}`,
      indicacoes: rows.map((r) => ({
        nome: r.nome,
        status: r.indicacao_creditada_em ? 'creditado' : 'pendente',
        criado_em: r.criado_em,
        creditado_em: r.indicacao_creditada_em,
      })),
    };
  }
```

**Nota (não é bug, é comportamento esperado em dev):** sem `PUBLIC_URL` setado, `base` cai no
host da própria requisição à API — em dev isso é `http://localhost:3000` (porta da API), não
`http://localhost:5173` (porta da retaguarda). O `link` retornado em dev vai apontar pra porta
errada. Em produção isso não acontece: API e retaguarda ficam atrás do mesmo domínio no Caddy
(`cahudelivery.duckdns.org`, `/v1/*` vai pra API e o resto pra retaguarda estática). Pra testar a
página do link em dev, troque manualmente a porta pra 5173 na URL.

- [ ] **Step 2: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: sem erro.

- [ ] **Step 3: Verificar com curl**

Reaproveite os clientes A/B da Task 4 se ainda existirem, ou cadastre um par novo (A indica B).
Logado como A:

```bash
curl -s http://localhost:3000/v1/indicacoes -H "X-Tenant: cahu" -H "Authorization: Bearer <TOKEN_A>"
```

Expected: `codigo` igual ao `codigo_indicacao` de A no banco; `link` termina em `/indica/<codigo>`;
`indicacoes` tem 1 item com `nome` de B e `status: "pendente"` (se B ainda não faturou) ou
`"creditado"` (se já rodou a Task 4 com esse par). Cliente sem nenhuma indicação feita:

```bash
curl -s http://localhost:3000/v1/indicacoes -H "X-Tenant: cahu" -H "Authorization: Bearer <TOKEN_DE_QUALQUER_OUTRO_CLIENTE>"
```

Expected: `indicacoes: []`.

Limpe os clientes de teste que não forem reaproveitados de uma task anterior.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/profile/profile.controller.ts
git commit -m "feat(api): endpoint GET /indicacoes (codigo, link e lista de indicacoes do cliente)"
```

---

### Task 6: Backend — `GET /admin/indicacoes` (fila da retaguarda)

**Files:**
- Modify: `apps/api/src/admin/admin.controller.ts`
- Modify: `apps/api/src/admin/admin.service.ts`

**Interfaces:**
- Produz: `GET /admin/indicacoes` → `{ dados: Array<{indicador, indicador_documento, indicado,
  indicado_documento, status, criado_em, creditado_em}>, pagina }` (mesma convenção `snake_case`
  já usada em `pedidos()`/`clientes()` neste arquivo) — consumido pela Task 10 (`Indicacoes.tsx`).

- [ ] **Step 1: Adicionar o método de serviço**

Em `apps/api/src/admin/admin.service.ts`, depois do método `lancarMovimentoCarteira` (último
método da classe, antes do `}` final), adicione:

```typescript

  async indicacoes(pagina: number) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select ind.nome_fantasia as indicador, ind.documento as indicador_documento,
              c.nome_fantasia as indicado, c.documento as indicado_documento,
              c.criado_em, c.indicacao_creditada_em
         from clientes c join clientes ind on ind.id = c.indicado_por_cliente_id
        where c.indicado_por_cliente_id is not null
        order by c.criado_em desc limit 25 offset $1`,
      [(pagina - 1) * 25],
    );
    return {
      dados: rows.map((r) => ({
        indicador: r.indicador,
        indicador_documento: r.indicador_documento,
        indicado: r.indicado,
        indicado_documento: r.indicado_documento,
        status: r.indicacao_creditada_em ? 'creditado' : 'pendente',
        criado_em: r.criado_em,
        creditado_em: r.indicacao_creditada_em,
      })),
      pagina,
    };
  }
```

- [ ] **Step 2: Adicionar a rota no controller**

Em `apps/api/src/admin/admin.controller.ts`, depois do método `lancarMovimento` (última rota,
antes do `}` final da classe), adicione:

```typescript

  @Get('indicacoes')
  indicacoes(@Query('pagina') pagina = '1') {
    return this.admin.indicacoes(Math.max(1, Number(pagina) || 1));
  }
```

- [ ] **Step 3: Build e rodar a API**

```bash
cd apps/api
npm run build && node dist/main.js
```

Expected: sem erro.

- [ ] **Step 4: Verificar com curl**

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/v1/admin/auth/login -H "X-Tenant: cahu" -H "Content-Type: application/json" -d '{"email":"admin@cahu.com.br","senha":"cahu@2026"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
curl -s "http://localhost:3000/v1/admin/indicacoes" -H "X-Tenant: cahu" -H "Authorization: Bearer $ADMIN_TOKEN"
```

Expected: `{"dados":[...],"pagina":1}`, cada item com `indicador`/`indicado`/`status`
preenchidos, batendo com os pares de teste criados nas tasks anteriores (se ainda existirem).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.service.ts
git commit -m "feat(api): endpoint GET /admin/indicacoes (fila com indicador, indicado e status)"
```

---

### Task 7: App Flutter — tela "Indique e ganhe" + item de menu

**Files:**
- Create: `apps/mobile/lib/features/profile/indicacoes_screen.dart`
- Modify: `apps/mobile/lib/features/profile/perfil_screen.dart`

**Interfaces:**
- Consome: `GET /indicacoes` (Task 5).
- Produz: `IndicacoesScreen` (StatefulWidget, sem parâmetros).

- [ ] **Step 1: Criar a tela**

Crie `apps/mobile/lib/features/profile/indicacoes_screen.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/api_client.dart';
import '../../core/formatadores.dart';
import '../../widgets/estados.dart';

/// "Indique e ganhe" (GET /v1/indicacoes) — cliente indica outro mercado
/// parceiro e ganha R$100 de saldo quando o indicado fatura o 1º pedido.
class IndicacoesScreen extends StatefulWidget {
  const IndicacoesScreen({super.key});

  @override
  State<IndicacoesScreen> createState() => _IndicacoesScreenState();
}

class _IndicacoesScreenState extends State<IndicacoesScreen> {
  String? _codigo;
  String? _link;
  List<Map<String, dynamic>>? _indicacoes;
  String? _erro;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _codigo = null;
      _link = null;
      _indicacoes = null;
      _erro = null;
    });
    try {
      final r = await ApiClient.instance.get('/indicacoes') as Map<String, dynamic>;
      if (mounted) {
        setState(() {
          _codigo = r['codigo'] as String?;
          _link = r['link'] as String?;
          _indicacoes = List<Map<String, dynamic>>.from(r['indicacoes'] as List? ?? const []);
        });
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _erro = e.message);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem conexão — verifique sua internet');
    }
  }

  Future<void> _copiarLink() async {
    if (_link == null) return;
    await Clipboard.setData(ClipboardData(text: _link!));
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Link copiado!'), behavior: SnackBarBehavior.floating));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Indique e ganhe')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    if (_erro != null) {
      return EstadoErro(mensagem: _erro, onTentarNovamente: _carregar);
    }
    if (_codigo == null) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: _carregar,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Indique um mercado parceiro',
                      style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  const SizedBox(height: 4),
                  const Text('Ganhe R\$100 de saldo quando ele fizer o primeiro pedido',
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: Colors.grey.shade100,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(_codigo!,
                              style: const TextStyle(
                                  fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 2)),
                        ),
                        TextButton.icon(
                          onPressed: _copiarLink,
                          icon: const Icon(Icons.copy, size: 18),
                          label: const Text('Copiar link'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_indicacoes!.isEmpty)
            const Padding(
              padding: EdgeInsets.only(top: 24),
              child: EstadoVazio(
                icone: Icons.card_giftcard_outlined,
                titulo: 'Nenhuma indicação ainda',
                mensagem: 'Indique um mercado parceiro e ganhe R\$100 quando ele fizer o primeiro pedido.',
              ),
            )
          else
            ..._indicacoes!.map((i) {
              final creditado = i['status'] == 'creditado';
              return Card(
                child: ListTile(
                  leading: Icon(
                    creditado ? Icons.check_circle : Icons.hourglass_top_outlined,
                    color: creditado ? Colors.green.shade700 : Colors.orange.shade700,
                  ),
                  title: Text(i['nome'] ?? ''),
                  subtitle: Text(creditado
                      ? 'R\$100 creditados em ${dataHora(i['creditado_em'])}'
                      : 'Aguardando primeiro pedido'),
                ),
              );
            }),
        ],
      ),
    );
  }
}
```

- [ ] **Step 2: Adicionar o item de menu em Perfil**

Em `apps/mobile/lib/features/profile/perfil_screen.dart`, adicione o import junto aos outros
(ordem alfabética, entre `enderecos_screen.dart` e `notas_fiscais_screen.dart`):

```dart
import 'enderecos_screen.dart';
import 'indicacoes_screen.dart';
import 'notas_fiscais_screen.dart';
```

No mesmo `Card` de opções, entre "Carteira" e "Sobre o app", troque:

```dart
                            _opcao(Icons.account_balance_wallet_outlined, 'Carteira', () {
                              Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => const CarteiraScreen()));
                            }),
                            _divisor(),
                            _opcao(Icons.info_outline, 'Sobre o app', _sobre),
```

por:

```dart
                            _opcao(Icons.account_balance_wallet_outlined, 'Carteira', () {
                              Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => const CarteiraScreen()));
                            }),
                            _divisor(),
                            _opcao(Icons.card_giftcard_outlined, 'Indique e ganhe', () {
                              Navigator.of(context).push(MaterialPageRoute(
                                  builder: (_) => const IndicacoesScreen()));
                            }),
                            _divisor(),
                            _opcao(Icons.info_outline, 'Sobre o app', _sobre),
```

- [ ] **Step 3: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/features/profile/indicacoes_screen.dart apps/mobile/lib/features/profile/perfil_screen.dart
git commit -m "feat(mobile): tela Indique e ganhe (codigo, copiar link, lista de indicacoes)"
```

---

### Task 8: App Flutter — campo de código no cadastro

**Files:**
- Modify: `apps/mobile/lib/features/auth/cadastro_screen.dart`

**Interfaces:**
- Produz: `POST /auth/registrar` ganha `codigoIndicacao` no body quando preenchido (consumido
  pelo backend da Task 2).

- [ ] **Step 1: Adicionar o controller**

Em `apps/mobile/lib/features/auth/cadastro_screen.dart`, troque:

```dart
  final _senha = TextEditingController();
  String? _categoria;
  bool _enviando = false;

  @override
  void dispose() {
    for (final c in [_documento, _nomeFantasia, _razaoSocial, _email, _telefone, _senha]) {
      c.dispose();
    }
    super.dispose();
  }
```

por:

```dart
  final _senha = TextEditingController();
  final _codigoIndicacao = TextEditingController();
  String? _categoria;
  bool _enviando = false;

  @override
  void dispose() {
    for (final c in [_documento, _nomeFantasia, _razaoSocial, _email, _telefone, _senha, _codigoIndicacao]) {
      c.dispose();
    }
    super.dispose();
  }
```

- [ ] **Step 2: Enviar no `POST /auth/registrar`**

Troque:

```dart
      final r = await ApiClient.instance.post('/auth/registrar', {
        'tipo': _tipo,
        'documento': _documento.text.replaceAll(RegExp(r'\D'), ''),
        'nomeFantasia': _nomeFantasia.text.trim(),
        if (_razaoSocial.text.trim().isNotEmpty) 'razaoSocial': _razaoSocial.text.trim(),
        'email': _email.text.trim(),
        if (_telefone.text.trim().isNotEmpty) 'telefone': _telefone.text.trim(),
        if (_categoria != null) 'categoria': _categoria,
        'senha': _senha.text,
      }) as Map<String, dynamic>;
```

por:

```dart
      final r = await ApiClient.instance.post('/auth/registrar', {
        'tipo': _tipo,
        'documento': _documento.text.replaceAll(RegExp(r'\D'), ''),
        'nomeFantasia': _nomeFantasia.text.trim(),
        if (_razaoSocial.text.trim().isNotEmpty) 'razaoSocial': _razaoSocial.text.trim(),
        'email': _email.text.trim(),
        if (_telefone.text.trim().isNotEmpty) 'telefone': _telefone.text.trim(),
        if (_categoria != null) 'categoria': _categoria,
        'senha': _senha.text,
        if (_codigoIndicacao.text.trim().isNotEmpty) 'codigoIndicacao': _codigoIndicacao.text.trim(),
      }) as Map<String, dynamic>;
```

- [ ] **Step 3: Adicionar o campo no formulário**

Troque o campo de senha e o botão (fim do `ListView`):

```dart
            TextFormField(
              controller: _senha,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Senha (mín. 6 caracteres)'),
              validator: (v) => (v ?? '').length >= 6 ? null : 'Mínimo de 6 caracteres',
            ),
            const SizedBox(height: 22),
            FilledButton(
```

por:

```dart
            TextFormField(
              controller: _senha,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Senha (mín. 6 caracteres)'),
              validator: (v) => (v ?? '').length >= 6 ? null : 'Mínimo de 6 caracteres',
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _codigoIndicacao,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(labelText: 'Código de indicação (opcional)'),
            ),
            const SizedBox(height: 22),
            FilledButton(
```

Erro 400 do backend (código inválido) já aparece automaticamente via
`ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)))` no `catch
(ApiException e)` que já existe em `_cadastrar()` — nenhuma mudança extra necessária aí.

- [ ] **Step 4: Analisar**

```bash
cd apps/mobile
flutter analyze
```

Expected: `No issues found!`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/features/auth/cadastro_screen.dart
git commit -m "feat(mobile): campo opcional de codigo de indicacao no cadastro"
```

---

### Task 9: Retaguarda — página pública `/indica/:codigo`

**Files:**
- Create: `apps/admin/src/paginas/IndicaLanding.tsx`
- Modify: `apps/admin/src/App.tsx`

**Interfaces:**
- Produz: rota `/indica/:codigo`, sem autenticação, lida direto o `codigo` da URL (não chama a
  API).

- [ ] **Step 1: Criar a página**

Crie `apps/admin/src/paginas/IndicaLanding.tsx`:

```tsx
import { useParams } from 'react-router-dom';

export function IndicaLanding() {
  const { codigo } = useParams<{ codigo: string }>();
  return (
    <div className="login-fundo">
      <div className="login-card">
        <div className="login-logo">
          <img src="/logo.png" alt="" onError={(e) => { e.currentTarget.parentElement!.style.display = 'none'; }} />
        </div>
        <h1>Você foi indicado!</h1>
        <p style={{ marginBottom: 4 }}>Baixe o app CAHU Delivery e digite o código abaixo no cadastro:</p>
        <div
          style={{
            fontSize: 28,
            fontWeight: 800,
            letterSpacing: 4,
            textAlign: 'center',
            padding: '16px 0',
            margin: '12px 0',
            background: '#f3f4f6',
            borderRadius: 12,
          }}
        >
          {codigo?.toUpperCase()}
        </div>
        <p style={{ fontSize: 13, color: 'var(--texto-2)' }}>
          Assim que seu primeiro pedido for faturado, quem te indicou ganha R$100 de saldo.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota (fora da autenticação)**

Em `apps/admin/src/App.tsx`, adicione o import (ordem alfabética, junto dos outros):

```tsx
import { IndicaLanding } from './paginas/IndicaLanding';
```

Troque:

```tsx
      <Routes>
        <Route path="/login" element={<Login />} />
        {ROTAS.map(([caminho, el]) => (
```

por:

```tsx
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/indica/:codigo" element={<IndicaLanding />} />
        {ROTAS.map(([caminho, el]) => (
```

(Fica no mesmo nível de `/login` — fora do `map` que envolve tudo em `<Protegido>`, então não
pede login nem redireciona.)

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

Abra `http://localhost:5173/indica/A3F9K2` (qualquer código, a página não valida contra a API).
Confirme: carrega sem pedir login, mostra o código em destaque, texto explicando o cadastro e a
recompensa. Teste também sem estar logado em outra aba/janela anônima, pra confirmar que não
redireciona pra `/login`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/paginas/IndicaLanding.tsx apps/admin/src/App.tsx
git commit -m "feat(admin): pagina publica /indica/:codigo (landing do convite, sem autenticacao)"
```

---

### Task 10: Retaguarda — página `Indicacoes.tsx` (fila)

**Files:**
- Create: `apps/admin/src/paginas/Indicacoes.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/Layout.tsx`
- Modify: `apps/admin/src/index.css`

**Interfaces:**
- Consome: `GET /admin/indicacoes` (Task 6).

- [ ] **Step 1: Criar a página**

Crie `apps/admin/src/paginas/Indicacoes.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api, fmtData } from '../api';

interface Indicacao {
  indicador: string;
  indicador_documento: string;
  indicado: string;
  indicado_documento: string;
  status: 'pendente' | 'creditado';
  criado_em: string;
  creditado_em: string | null;
}

export function Indicacoes() {
  const [dados, setDados] = useState<Indicacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api<{ dados: Indicacao[] }>('/admin/indicacoes')
      .then((r) => setDados(r.dados))
      .catch((e) => setErro(e.message));
  }, []);

  return (
    <>
      <h1>Indique e Ganhe</h1>
      {erro && <div className="erro-texto">{erro}</div>}
      <div className="tabela-wrap">
        <table>
          <thead>
            <tr><th>Indicador</th><th>Indicado</th><th>Status</th><th>Cadastro</th><th>Crédito</th></tr>
          </thead>
          <tbody>
            {dados?.map((i, idx) => (
              <tr key={idx}>
                <td>
                  <strong>{i.indicador}</strong>
                  <div className="mono" style={{ fontSize: 12 }}>{i.indicador_documento}</div>
                </td>
                <td>
                  <strong>{i.indicado}</strong>
                  <div className="mono" style={{ fontSize: 12 }}>{i.indicado_documento}</div>
                </td>
                <td><span className={`badge ${i.status}`}>{i.status === 'creditado' ? 'Creditado' : 'Aguardando'}</span></td>
                <td>{fmtData(i.criado_em)}</td>
                <td>{i.creditado_em ? fmtData(i.creditado_em) : '—'}</td>
              </tr>
            ))}
            {dados && !dados.length && <tr><td colSpan={5} className="vazio">Nenhuma indicação ainda</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `apps/admin/src/App.tsx`, adicione o import (ordem alfabética, junto dos outros):

```tsx
import { Indicacoes } from './paginas/Indicacoes';
```

No array `ROTAS`, entre `/credito` e `/carteira`:

```tsx
  ['/credito', <SolicitacoesCredito />],
  ['/indicacoes', <Indicacoes />],
  ['/carteira', <Carteira />],
```

- [ ] **Step 3: Adicionar o link no menu lateral**

Em `apps/admin/src/Layout.tsx`, no array `LINKS`, entre `/credito` e `/carteira`:

```tsx
  { para: '/credito', rotulo: '💳 Crédito' },
  { para: '/indicacoes', rotulo: '🎁 Indique e Ganhe' },
  { para: '/carteira', rotulo: '💰 Carteira' },
```

- [ ] **Step 4: Adicionar o estilo do badge "creditado"**

Em `apps/admin/src/index.css`, depois da linha `.badge.excluido { ... }`, adicione:

```css
.badge.creditado { background: #dcfce7; color: var(--verde); }
```

(`.badge.pendente` já existe no arquivo — reaproveitado sem mudança pro status "Aguardando".)

- [ ] **Step 5: Verificar o build**

```bash
cd apps/admin
npx tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 6: Verificar no navegador**

```bash
npx vite --host
```

Login na retaguarda. Abra `/indicacoes`. Se ainda existir algum par de teste das tasks
anteriores, confirme que aparece na tabela com indicador/indicado/status corretos. Lance um novo
par de teste (cadastro A, cadastro B com código de A) e confirme que aparece como "Aguardando".
Se rodar o fluxo completo até faturar (Task 4), confirme que o badge muda pra "Creditado" e a
coluna Crédito preenche.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/paginas/Indicacoes.tsx apps/admin/src/App.tsx apps/admin/src/Layout.tsx apps/admin/src/index.css
git commit -m "feat(admin): fila de indicacoes (indicador, indicado, status)"
```

---

## Verificação final (fim a fim)

1. Cliente A abre "Indique e ganhe" em Perfil, copia o link, vê o código.
2. Alguém abre o link (`/indica/<codigo>`) sem estar logado em lugar nenhum — vê a página
   explicando o cadastro e a recompensa, sem pedir login.
3. Essa pessoa se cadastra no app digitando o código de A — cadastro funciona normal.
4. Ela fecha um pedido; até ele chegar a `FATURADO` (via ERP mock ou de verdade), a indicação
   aparece como "Aguardando" tanto pro cliente A (tela do app) quanto na retaguarda
   (`/indicacoes`).
5. Quando o pedido fatura, o worker credita R$100 na carteira de A automaticamente — sem ação
   manual de ninguém. A tela "Indique e ganhe" de A e a fila da retaguarda mostram "Creditado".
6. Cadastro com código inválido é rejeitado com mensagem clara; cadastro sem código continua
   funcionando normal (comportamento anterior preservado).
7. Excluir um cliente que já indicou alguém (mas não tem pedido nem carteira) não quebra — vira
   anonimização, igual ao comportamento já existente com carteira/favoritos/crédito.
