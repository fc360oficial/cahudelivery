# Fase 4a — Outbound de Pedidos + Autenticação Inbound (Dlinks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao Dlinks (ERP da CAHU) um jeito de consultar pedidos do CAHU Delivery e confirmar recebimento/cancelamento, autenticado por apikey própria — a única parte da integração cujo contrato é 100% nosso.

**Architecture:** Novo middleware resolve o tenant a partir do header `apikey` (em vez do `X-Tenant` normal) e popula o mesmo `AsyncLocalStorage` já usado por `tenantCtx()`. Três endpoints novos sob `/v1/integracoes/dlinks/*`. O `OutboxWorker` ganha um desvio: quando o adaptador declara `suportaPull: true`, ele para de tentar empurrar o pedido — o pedido fica em `RECEBIDO` até o Dlinks confirmar via `POST /recebido`.

**Tech Stack:** NestJS, PostgreSQL (`pg`), class-validator/class-transformer. Sem framework de teste automatizado neste projeto — verificação é sempre via `curl` real contra API+Postgres locais (convenção já estabelecida em todo o histórico do projeto).

## Global Constraints

- Nunca escrever no banco do ERP (não se aplica aqui — Dlinks é quem escreve no nosso banco via estes endpoints).
- Toda query de tenant passa por `tenantCtx()` — nenhuma query roda sem tenant resolvido.
- Migração de banco de controle precisa existir em dois lugares idênticos: `infra/sql/control/` (repo) e `../../11 - SQL/control/` (pasta irmã fora do repo, fonte espelhada usada como referência histórica) — manter os dois em sincronia, mesma convenção já usada pelas migrações de tenant.
- `duracao_ms` em `integracao_logs` é opcional (nullable) — pode ser omitido nos inserts desta fase.
- Toda mudança de status de pedido grava um evento em `pedido_eventos` (mesma convenção já usada por `OutboxWorker.sincronizarStatus`).

---

### Task 1: Contrato do adaptador — nova capacidade `suportaPull`

**Files:**
- Modify: `packages/erp-adapters/src/contrato.ts`
- Modify: `packages/erp-adapters/src/mock/mock-adapter.ts`
- Modify: `apps/api/src/integration/integration.service.ts`

**Interfaces:**
- Produces: `ErpCapacidades.suportaPull: boolean` — usado pelo `OutboxWorker` na Task 6.

- [ ] **Step 1: Adicionar o campo na interface**

Em `packages/erp-adapters/src/contrato.ts`, dentro de `ErpCapacidades` (linhas 94-100), adicionar a última propriedade:

```typescript
export interface ErpCapacidades {
  suportaWebhook: boolean;
  suportaPrecoPorCliente: boolean;
  suportaPix: boolean;
  suportaBoleto: boolean;
  suportaSyncIncremental: boolean;
  suportaPull: boolean; // true = o ERP consulta pedidos (GET), não recebe push
}
```

- [ ] **Step 2: Atualizar o mock do pacote `erp-adapters`**

Em `packages/erp-adapters/src/mock/mock-adapter.ts`, no objeto `capacidades` do mock, adicionar `suportaPull: false,` (mock continua sendo um ERP de push).

- [ ] **Step 3: Atualizar o `DevMockAdapter` da API (cópia separada, mesmo drift já conhecido do projeto)**

Em `apps/api/src/integration/integration.service.ts:13-19`, o bloco `readonly capacidades` fica:

```typescript
  readonly capacidades = {
    suportaWebhook: false,
    suportaPrecoPorCliente: true,
    suportaPix: true,
    suportaBoleto: true,
    suportaSyncIncremental: true,
    suportaPull: false,
  };
```

- [ ] **Step 4: Verificar que compila**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem saída (sem erros).

- [ ] **Step 5: Commit**

```bash
git add packages/erp-adapters/src/contrato.ts packages/erp-adapters/src/mock/mock-adapter.ts apps/api/src/integration/integration.service.ts
git commit -m "feat(erp-adapters): adiciona capacidade suportaPull ao contrato"
```

---

### Task 2: Migração — tabela `integracao_credenciais`

**Files:**
- Create: `infra/sql/control/002_integracao_credenciais.sql`
- Create: `../../11 - SQL/control/002_integracao_credenciais.sql` (mesmo conteúdo, mirror fora do repo)

**Interfaces:**
- Produces: tabela `integracao_credenciais(id, tenant_id, adaptador, apikey_hash, ativo, criado_em)` no banco `fluxo_control`, usada pela Task 3.

- [ ] **Step 1: Escrever a migração**

```sql
-- =====================================================================
-- Fluxo Commerce — Banco de CONTROLE (fluxo_control)
-- Migração 002 — credenciais de integração inbound (ex.: apikey do Dlinks)
-- =====================================================================

create table if not exists integracao_credenciais (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  adaptador     text not null default 'dlinks',
  apikey_hash   text not null unique,   -- sha256 hex da apikey em texto puro
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create index if not exists idx_integracao_credenciais_tenant on integracao_credenciais (tenant_id);

insert into schema_migrations (versao) values ('002') on conflict do nothing;
```

Salvar esse conteúdo em `infra/sql/control/002_integracao_credenciais.sql` E em
`../../11 - SQL/control/002_integracao_credenciais.sql` (caminho relativo à raiz do
repo `fluxo-commerce`; a pasta `11 - SQL` é irmã de `fluxo-commerce` dentro de
`CAHU DELIVERY`).

- [ ] **Step 2: Aplicar no banco de controle local**

Run: `psql -U postgres -d fluxo_control -f infra/sql/control/002_integracao_credenciais.sql`
Expected: `CREATE TABLE`, `CREATE INDEX`, `INSERT 0 1` (ou `INSERT 0 0` se já aplicada antes).

- [ ] **Step 3: Gerar uma apikey de teste e inserir o hash**

Run (gera uma apikey aleatória e mostra o hash sha256 dela — guardar a apikey em texto puro, ela não fica salva em lugar nenhum além deste terminal):

```bash
node -e "
const crypto = require('crypto');
const apikey = crypto.randomBytes(24).toString('hex');
console.log('APIKEY (guardar, não fica salva em texto puro):', apikey);
console.log('HASH (vai pro banco):', crypto.createHash('sha256').update(apikey).digest('hex'));
"
```

Expected: duas linhas impressas — `APIKEY: ...` e `HASH: ...`. Anotar a `APIKEY` para usar nos testes das próximas tasks.

Run (substituindo `<HASH>` pelo hash impresso acima, e `<TENANT_SLUG>` pelo slug do tenant de dev, ex. `cahu`):

```bash
psql -U postgres -d fluxo_control -c "insert into integracao_credenciais (tenant_id, apikey_hash) select id, '<HASH>' from tenants where slug = '<TENANT_SLUG>';"
```

Expected: `INSERT 0 1`.

- [ ] **Step 4: Confirmar a linha inserida**

Run: `psql -U postgres -d fluxo_control -c "select ic.id, t.slug, ic.ativo from integracao_credenciais ic join tenants t on t.id = ic.tenant_id;"`
Expected: uma linha com o slug do tenant e `ativo = t`.

- [ ] **Step 5: Commit**

```bash
git add infra/sql/control/002_integracao_credenciais.sql
git commit -m "feat(db): migração 002 — tabela integracao_credenciais (apikey por tenant)"
```

(O arquivo espelhado em `../../11 - SQL/control/` fica fora do repo git do `fluxo-commerce` — só copiar, sem commit.)

---

### Task 3: Middleware de autenticação + módulo + `GET /pedidos`

**Files:**
- Create: `apps/api/src/integracoes-dlinks/dlinks-auth.middleware.ts`
- Create: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`
- Create: `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`
- Create: `apps/api/src/integracoes-dlinks/dlinks.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `DatabaseService.controlPool()`, `DatabaseService.getTenant(slug)`, `DatabaseService.getTenantPool(slug)` (todos já existem em `apps/api/src/database/database.service.ts`); `runComTenant(ctx, fn)` e `tenantCtx()` de `apps/api/src/tenancy/tenant-context.ts`.
- Produces: `DlinksPedidosService.listar(dataInicial: string, dataFinal: string): Promise<{ pedidos: PedidoDlinks[] }>` — usado só aqui nesta fase, mas o formato de `PedidoDlinks` é a referência para as próximas fases lerem.

- [ ] **Step 1: Escrever o middleware de autenticação**

Criar `apps/api/src/integracoes-dlinks/dlinks-auth.middleware.ts`:

```typescript
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Resolve o tenant a partir do header `apikey` (não `X-Tenant`) — usado só
 * nas rotas chamadas pelo Dlinks, que não conhece nosso conceito de tenant.
 */
@Injectable()
export class DlinksAuthMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const apikey = req.headers['apikey'] as string | undefined;
    if (!apikey) throw new UnauthorizedException('Header apikey ausente');
    const hash = createHash('sha256').update(apikey).digest('hex');
    const { rows } = await this.db.controlPool().query(
      `select t.slug from integracao_credenciais ic
         join tenants t on t.id = ic.tenant_id
        where ic.apikey_hash = $1 and ic.ativo = true`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('apikey inválida');
    const tenant = await this.db.getTenant(rows[0].slug);
    const pool = await this.db.getTenantPool(rows[0].slug);
    await runComTenant({ tenant, pool }, async () => next());
  }
}
```

- [ ] **Step 2: Escrever o service com o primeiro método (`listar`)**

Criar `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';

export interface PedidoDlinks {
  codigo: string;
  criadoEm: string;
  cliente: { documento: string; erpClienteId: string | null };
  tipoEntrega: string;
  endereco: Record<string, unknown> | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  itens: Array<{ erpProdutoId: string; quantidade: number; precoUnit: number }>;
  valorAbatidoSaldo: number;
}

export interface ResultadoLote {
  processados: string[];
  ignorados: Array<{ codigo: string; motivo: 'nao_encontrado' | 'status_invalido' }>;
}

@Injectable()
export class DlinksPedidosService {
  async listar(dataInicial: string, dataFinal: string): Promise<{ pedidos: PedidoDlinks[] }> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select p.id, p.criado_em, p.tipo_entrega, p.forma_pagamento, p.condicao_pagamento,
              p.endereco_snapshot_json, p.valor_saldo_usado,
              c.documento, c.erp_cliente_id,
              (select json_agg(json_build_object(
                  'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                  'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i join produtos pr on pr.id = i.produto_id
                where i.pedido_id = p.id) as itens
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em::date between $1 and $2
        order by p.criado_em`,
      [dataInicial, dataFinal],
    );
    return {
      pedidos: rows.map((r) => ({
        codigo: r.id,
        criadoEm: r.criado_em,
        cliente: { documento: r.documento, erpClienteId: r.erp_cliente_id },
        tipoEntrega: r.tipo_entrega,
        endereco: r.endereco_snapshot_json,
        formaPagamento: r.forma_pagamento,
        condicaoPagamento: r.condicao_pagamento,
        itens: r.itens ?? [],
        valorAbatidoSaldo: Number(r.valor_saldo_usado) || 0,
      })),
    };
  }
}
```

- [ ] **Step 3: Escrever o controller com só o `GET /pedidos` por enquanto**

Criar `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { DlinksPedidosService } from './dlinks-pedidos.service';

@Controller('integracoes/dlinks')
export class DlinksPedidosController {
  constructor(private readonly service: DlinksPedidosService) {}

  @Get('pedidos')
  listar(@Query('data_inicial') dataInicial: string, @Query('data_final') dataFinal: string) {
    return this.service.listar(dataInicial, dataFinal);
  }
}
```

- [ ] **Step 4: Escrever o módulo**

Criar `apps/api/src/integracoes-dlinks/dlinks.module.ts`:

```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DlinksAuthMiddleware } from './dlinks-auth.middleware';
import { DlinksPedidosController } from './dlinks-pedidos.controller';
import { DlinksPedidosService } from './dlinks-pedidos.service';

@Module({
  controllers: [DlinksPedidosController],
  providers: [DlinksPedidosService],
})
export class DlinksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DlinksAuthMiddleware).forRoutes(DlinksPedidosController);
  }
}
```

- [ ] **Step 5: Registrar o módulo em `AppModule`**

Em `apps/api/src/app.module.ts`, adicionar o import e incluir `DlinksModule` no array `imports`:

```typescript
import { DlinksModule } from './integracoes-dlinks/dlinks.module';
```

```typescript
  imports: [DatabaseModule, IntegrationModule, AuthModule, CatalogModule, OrdersModule, ProfileModule, AdminModule, DlinksModule],
```

- [ ] **Step 6: Subir a API local e testar sem apikey (deve dar 401)**

Run: `cd apps/api && npm run start:dev` (deixar rodando em outro terminal)

Run:
```bash
curl -i "http://localhost:3000/v1/integracoes/dlinks/pedidos?data_inicial=2026-01-01&data_final=2026-12-31"
```
Expected: `HTTP/1.1 401 Unauthorized`, corpo com `"message":"Header apikey ausente"`.

- [ ] **Step 7: Testar com apikey errada (deve dar 401)**

Run:
```bash
curl -i -H "apikey: chave-errada" "http://localhost:3000/v1/integracoes/dlinks/pedidos?data_inicial=2026-01-01&data_final=2026-12-31"
```
Expected: `HTTP/1.1 401 Unauthorized`, corpo com `"message":"apikey inválida"`.

- [ ] **Step 8: Testar com a apikey real (gerada na Task 2, Step 3) — deve listar pedidos**

Run (substituindo `<APIKEY>` pela gerada na Task 2):
```bash
curl -s -H "apikey: <APIKEY>" "http://localhost:3000/v1/integracoes/dlinks/pedidos?data_inicial=2026-01-01&data_final=2026-12-31" | head -c 500
```
Expected: `HTTP 200` (sem `-i` não aparece, mas confirmar com `-i` numa segunda chamada se quiser) e corpo `{"pedidos":[...]}` — lista vazia `{"pedidos":[]}` é uma resposta válida se não houver pedido de teste no banco dev nesse período; se houver pedido de teste criado antes, ele aparece com todos os campos (`codigo`, `criadoEm`, `cliente`, `itens`, etc.).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/integracoes-dlinks apps/api/src/app.module.ts
git commit -m "feat(api): autenticacao por apikey e GET /integracoes/dlinks/pedidos"
```

---

### Task 4: `POST /pedidos/recebido`

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`
- Create: `apps/api/src/integracoes-dlinks/codigos.dto.ts`

**Interfaces:**
- Consumes: `ResultadoLote` (definido na Task 3, Step 2).
- Produces: `DlinksPedidosService.marcarRecebido(codigos: string[]): Promise<ResultadoLote>`.

- [ ] **Step 1: Criar o DTO de entrada (compartilhado com a Task 5)**

Criar `apps/api/src/integracoes-dlinks/codigos.dto.ts`:

```typescript
import { IsArray, IsUUID } from 'class-validator';

export class CodigosDto {
  @IsArray()
  @IsUUID('4', { each: true })
  codigos!: string[];
}
```

- [ ] **Step 2: Adicionar `marcarRecebido` ao service**

Em `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`, adicionar dentro da classe `DlinksPedidosService`:

```typescript
  async marcarRecebido(codigos: string[]): Promise<ResultadoLote> {
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      const atual = await pool.query(`select status from pedidos where id = $1`, [codigo]);
      if (!atual.rowCount) {
        ignorados.push({ codigo, motivo: 'nao_encontrado' });
        continue;
      }
      if (atual.rows[0].status !== 'RECEBIDO') {
        ignorados.push({ codigo, motivo: 'status_invalido' });
        continue;
      }
      await pool.query(`update pedidos set status = 'ENVIADO_ERP' where id = $1`, [codigo]);
      await pool.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'ENVIADO_ERP','Confirmado pelo Dlinks','erp')`,
        [codigo],
      );
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ('pedido_recebido','erp_para_fluxo',$1,true)`,
        [codigo],
      );
      processados.push(codigo);
    }
    return { processados, ignorados };
  }
```

- [ ] **Step 3: Adicionar a rota no controller**

Em `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`, adicionar o import do DTO e o novo método:

```typescript
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CodigosDto } from './codigos.dto';
import { DlinksPedidosService } from './dlinks-pedidos.service';
```

```typescript
  @Post('pedidos/recebido')
  recebido(@Body() dto: CodigosDto) {
    return this.service.marcarRecebido(dto.codigos);
  }
```

- [ ] **Step 4: Criar um pedido de teste no banco dev pra testar (se não houver nenhum em `RECEBIDO`)**

Run: `psql -U postgres -d fluxo_t_cahu -c "select id, status from pedidos where status = 'RECEBIDO' limit 1;"`
Expected: uma linha com um `id` — anotar esse `id` para o próximo passo. Se não houver nenhuma linha, criar um pedido de teste pela app antes de continuar (fluxo já validado em sessões anteriores do projeto).

- [ ] **Step 5: Testar `POST /recebido` com o id real**

Run (substituindo `<APIKEY>` e `<PEDIDO_ID>`):
```bash
curl -s -X POST -H "apikey: <APIKEY>" -H "Content-Type: application/json" \
  -d '{"codigos":["<PEDIDO_ID>"]}' \
  http://localhost:3000/v1/integracoes/dlinks/pedidos/recebido
```
Expected: `{"processados":["<PEDIDO_ID>"],"ignorados":[]}`

Run (confirmar no banco):
```bash
psql -U postgres -d fluxo_t_cahu -c "select status from pedidos where id = '<PEDIDO_ID>';"
```
Expected: `ENVIADO_ERP`.

- [ ] **Step 6: Testar idempotência — chamar de novo com o mesmo id**

Run (mesmo comando do Step 5).
Expected: `{"processados":[],"ignorados":[{"codigo":"<PEDIDO_ID>","motivo":"status_invalido"}]}` (já não está mais em `RECEBIDO`).

- [ ] **Step 7: Testar código inexistente**

Run:
```bash
curl -s -X POST -H "apikey: <APIKEY>" -H "Content-Type: application/json" \
  -d '{"codigos":["00000000-0000-0000-0000-000000000000"]}' \
  http://localhost:3000/v1/integracoes/dlinks/pedidos/recebido
```
Expected: `{"processados":[],"ignorados":[{"codigo":"00000000-0000-0000-0000-000000000000","motivo":"nao_encontrado"}]}`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/integracoes-dlinks
git commit -m "feat(api): POST /integracoes/dlinks/pedidos/recebido"
```

---

### Task 5: `POST /pedidos/cancelado`

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`

**Interfaces:**
- Consumes: `CodigosDto` (Task 4), `ResultadoLote` (Task 3).
- Produces: `DlinksPedidosService.marcarCancelado(codigos: string[]): Promise<ResultadoLote>`.

- [ ] **Step 1: Adicionar `marcarCancelado` ao service**

Em `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`, adicionar:

```typescript
  async marcarCancelado(codigos: string[]): Promise<ResultadoLote> {
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      const atual = await pool.query(`select status from pedidos where id = $1`, [codigo]);
      if (!atual.rowCount) {
        ignorados.push({ codigo, motivo: 'nao_encontrado' });
        continue;
      }
      if (atual.rows[0].status === 'ENTREGUE') {
        ignorados.push({ codigo, motivo: 'status_invalido' });
        continue;
      }
      await pool.query(`update pedidos set status = 'CANCELADO' where id = $1`, [codigo]);
      await pool.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO','Cancelado pelo Dlinks','erp')`,
        [codigo],
      );
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ('pedido_cancelado','erp_para_fluxo',$1,true)`,
        [codigo],
      );
      processados.push(codigo);
    }
    return { processados, ignorados };
  }
```

- [ ] **Step 2: Adicionar a rota no controller**

Em `apps/api/src/integracoes-dlinks/dlinks-pedidos.controller.ts`, adicionar:

```typescript
  @Post('pedidos/cancelado')
  cancelado(@Body() dto: CodigosDto) {
    return this.service.marcarCancelado(dto.codigos);
  }
```

- [ ] **Step 3: Criar 2 pedidos de teste — um em `EM_SEPARACAO`, outro em `ENTREGUE`**

Run:
```bash
psql -U postgres -d fluxo_t_cahu -c "select id, status from pedidos where status in ('EM_SEPARACAO','ENTREGUE') limit 2;"
```
Anotar os dois ids. Se não existirem pedidos nesses status, atualizar manualmente 2 pedidos de teste existentes: `update pedidos set status = 'EM_SEPARACAO' where id = '<ID_A>'; update pedidos set status = 'ENTREGUE' where id = '<ID_B>';`

- [ ] **Step 4: Testar cancelamento do pedido em `EM_SEPARACAO` (deve funcionar)**

Run (substituindo `<APIKEY>` e `<ID_A>`):
```bash
curl -s -X POST -H "apikey: <APIKEY>" -H "Content-Type: application/json" \
  -d '{"codigos":["<ID_A>"]}' \
  http://localhost:3000/v1/integracoes/dlinks/pedidos/cancelado
```
Expected: `{"processados":["<ID_A>"],"ignorados":[]}`

- [ ] **Step 5: Testar cancelamento do pedido `ENTREGUE` (deve ser rejeitado)**

Run (substituindo `<ID_B>`):
```bash
curl -s -X POST -H "apikey: <APIKEY>" -H "Content-Type: application/json" \
  -d '{"codigos":["<ID_B>"]}' \
  http://localhost:3000/v1/integracoes/dlinks/pedidos/cancelado
```
Expected: `{"processados":[],"ignorados":[{"codigo":"<ID_B>","motivo":"status_invalido"}]}`

- [ ] **Step 6: Confirmar no banco**

Run: `psql -U postgres -d fluxo_t_cahu -c "select id, status from pedidos where id in ('<ID_A>','<ID_B>');"`
Expected: `<ID_A>` → `CANCELADO`; `<ID_B>` → continua `ENTREGUE`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integracoes-dlinks
git commit -m "feat(api): POST /integracoes/dlinks/pedidos/cancelado"
```

---

### Task 6: `OutboxWorker` — não empurrar pedido quando o adaptador é pull

**Files:**
- Modify: `apps/api/src/orders/outbox.worker.ts:46-106` (método `processarOutbox`)

**Interfaces:**
- Consumes: `ErpAdapter.capacidades.suportaPull` (Task 1).

- [ ] **Step 1: Adicionar o desvio logo após resolver o adapter, dentro do loop de eventos**

Em `apps/api/src/orders/outbox.worker.ts`, dentro de `processarOutbox()`, o loop `for (const ev of rows) { ... }` (linhas 54-104) ganha um desvio no início do corpo do loop — antes de `const ini = Date.now();` (linha 55):

```typescript
      for (const ev of rows) {
        if (adapter.capacidades.suportaPull) {
          // Adaptador pull (ex.: Dlinks): não empurramos, o pedido fica em
          // RECEBIDO até o ERP confirmar via POST /integracoes/dlinks/pedidos/recebido.
          await pool.query(`update sync_outbox set processado_em = now() where id = $1`, [ev.id]);
          continue;
        }
        const ini = Date.now();
        try {
```

(o `try { ... } catch (e) { ... }` que já existia continua igual, só ganhou esse `if` antes dele — atenção pra não duplicar a declaração de `const ini` que já existe dentro do bloco original, remover a linha `const ini = Date.now();` antiga já que ela sobe pro novo lugar).

- [ ] **Step 2: Verificar que compila**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem saída.

- [ ] **Step 3: Teste manual — trocar o mock por um adapter `suportaPull: true` temporariamente**

Em `apps/api/src/integration/integration.service.ts`, mudar temporariamente `suportaPull: false` para `suportaPull: true` no `DevMockAdapter` (só para este teste manual — reverter no Step 5).

Run: reiniciar a API (`npm run start:dev`), criar um pedido novo pela app/curl normal do fluxo de checkout já existente.

Run (depois de ~10s, tempo do worker rodar):
```bash
psql -U postgres -d fluxo_t_cahu -c "select id, status, erp_pedido_id from pedidos order by criado_em desc limit 1;"
```
Expected: `status = RECEBIDO`, `erp_pedido_id` = `null` (não foi empurrado).

Run:
```bash
psql -U postgres -d fluxo_t_cahu -c "select processado_em is not null as processado from sync_outbox order by criado_em desc limit 1;"
```
Expected: `processado = t` (a outbox marcou como processada mesmo sem empurrar).

- [ ] **Step 4: Confirmar que o pedido aparece no GET /pedidos e some do fluxo normal de push**

Run (substituindo `<APIKEY>` e as datas de hoje):
```bash
curl -s -H "apikey: <APIKEY>" "http://localhost:3000/v1/integracoes/dlinks/pedidos?data_inicial=2026-08-28&data_final=2026-08-28"
```
Expected: o pedido criado no Step 3 aparece na lista.

- [ ] **Step 5: Reverter o `suportaPull: true` de teste**

Em `apps/api/src/integration/integration.service.ts`, voltar `suportaPull: false` no `DevMockAdapter` (o mock de dev continua sendo push — só o adaptador real do Dlinks, que ainda não existe nesta fase, vai usar `true` de verdade).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/orders/outbox.worker.ts
git commit -m "feat(api): OutboxWorker pula push quando adaptador suporta pull"
```

---

## Verificação final (revisão de branch)

Depois das 6 tasks, confirmar de ponta a ponta:

1. `cd apps/api && npx tsc --noEmit` limpo.
2. Fluxo completo: pedido criado → aparece em `GET /pedidos` → `POST /recebido` transiciona pra `ENVIADO_ERP` → tentar `POST /recebido` de novo cai em `ignorados`.
3. `POST /cancelado` funciona em qualquer status exceto `ENTREGUE`.
4. Autenticação: sem apikey, apikey errada e apikey de tenant desativado (`update integracao_credenciais set ativo = false ...` e testar) todos dão 401.
5. Adaptador mock (`suportaPull: false`) continua funcionando exatamente como antes — nenhuma regressão no fluxo de pedido existente (checkout → RECEBIDO → ENVIADO_ERP → FATURADO → ... continua andando sozinho via polling do mock).
