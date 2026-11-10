# Fluxo Vendas Fase 1 — Plano 1 de 3: API e banco

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à API tudo que o app do vendedor e a retaguarda de vendas precisam: vendedor e carteira vindos do ERP, login do vendedor, carga de dados para o celular, recebimento de pedido com retenção por divergência, orçamentos e os endpoints de administração.

**Architecture:** Um módulo novo `apps/api/src/vendas` (rotas `/v1/vendas/*` para o app e `/v1/admin/vendas/*` para a retaguarda) e dois endpoints novos no módulo `integracoes-dlinks`. O pedido do vendedor grava na mesma tabela `pedidos` e segue o fluxo atual até o ERP; orçamento fica em tabela própria. Toda mudança de banco é aditiva (migração 034).

**Tech Stack:** NestJS 11, TypeScript, `pg` com SQL puro (sem ORM), class-validator, argon2, `@nestjs/jwt`, Jest 30, PostgreSQL 16.

Especificação: `docs/superpowers/specs/2026-11-09-fluxo-vendas-fase1-design.md`. Planos seguintes: 2 (app Flutter `apps/vendas`) e 3 (retaguarda, seção Vendas).

## Global Constraints

- Somente mudanças aditivas no banco. Nenhuma coluna ou tabela existente é removida ou tem tipo alterado.
- Nenhum arquivo do app do cliente (`apps/mobile`) ou da retaguarda (`apps/admin`) é alterado neste plano.
- SQL puro com `tenantCtx().pool`, no padrão dos serviços existentes. Sem ORM, sem biblioteca nova.
- Preço do pedido do vendedor é sempre o de `precos` para a tabela escolhida. Sem promoção, sem desconto por quantidade, sem desconto manual, sem fallback para a tabela padrão.
- Orçamento nunca é gravado em `pedidos`.
- Pedido com status `AGUARDANDO_VENDEDOR` nunca aparece na consulta de pedidos do ERP.
- Token do vendedor: `{ sub, slug, tipo: 'vendedor' }`. Token de um tenant não vale em outro.
- Testes no padrão do repositório: unitários com `pool.query` simulado por `jest.fn` e `runComTenant`. Rodar com `npm test -w apps/api -- <arquivo>` a partir da raiz do repositório.
- Mensagens de erro para o usuário em português.
- Documentos externos não citam o nome do aplicativo de terceiros usado hoje.
- Commits em português, no estilo do histórico (`Vendas: ...`), terminando com `Co-Authored-By: Claude <noreply@anthropic.com>`.

## Desvios da especificação decididos neste plano

1. A primeira migração livre é a **034** (o repositório já tem 032 e 033).
2. A carga para o celular é **completa a cada sincronização**, sem parâmetro `desde`. Com 9 vendedores e cerca de 7 mil preços, a carga completa é pequena e elimina o controle de alterações e exclusões.
3. O app envia **um pedido por chamada**. O envio em lote fica por conta do app, que percorre a fila.
4. Pedido de cliente que saiu da carteira é **recusado** (403 `CLIENTE_FORA_DA_CARTEIRA`), não retido, porque o vendedor não teria como resolvê-lo confirmando.
5. Ao confirmar um pedido retido, `criado_em` passa a ser o momento da confirmação. O ERP consulta pedidos por data de criação e perderia um pedido retido ontem e confirmado hoje.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `infra/sql/tenant/034_fluxo_vendas.sql` | Tabelas e colunas novas |
| `apps/api/src/integracoes-dlinks/funcionario.dto.ts`, `cliente-funcionario.dto.ts` | Formato dos dois envios novos do ERP |
| `apps/api/src/integracoes-dlinks/dlinks-vendedores.service.ts`, `.controller.ts` | Gravar vendedores e carteira |
| `apps/api/src/vendas/vendas.module.ts` | Módulo |
| `apps/api/src/vendas/vendas-auth.service.ts`, `vendas-auth.controller.ts`, `vendedor.guard.ts` | Login, renovação e proteção das rotas |
| `apps/api/src/vendas/vendas-sync.service.ts` | Carga para o celular |
| `apps/api/src/vendas/conferir-pedido.ts` | Regra pura de divergência (preço, estoque, crédito) |
| `apps/api/src/vendas/pedido-vendedor.dto.ts`, `vendas-pedidos.service.ts` | Receber, confirmar, cancelar e listar pedidos |
| `apps/api/src/vendas/orcamento.dto.ts`, `vendas-orcamentos.service.ts` | Orçamentos |
| `apps/api/src/vendas/vendas-resumo.service.ts` | Números da tela Início |
| `apps/api/src/vendas/vendas.controller.ts` | Rotas `/v1/vendas/*` |
| `apps/api/src/vendas/admin-vendas.controller.ts` | Rotas `/v1/admin/vendas/*` |

---

### Task 1: Migração 034

**Files:**
- Create: `infra/sql/tenant/034_fluxo_vendas.sql`
- Create (espelho): `..\11 - SQL\tenant\034_fluxo_vendas.sql` (pasta irmã do repositório, exigida por `infra/sql/README.md`)

**Interfaces:**
- Produces: tabelas `vendedores`, `cliente_vendedor`, `tabela_preco_condicoes`, `orcamentos`, `orcamento_itens`; colunas `pedidos.vendedor_id`, `origem`, `tabela_preco_id`, `condicao_pagamento_id`, `id_dispositivo`, `retencao_json`, `criado_no_aparelho_em`; status `AGUARDANDO_VENDEDOR`; `refresh_tokens.sujeito = 'vendedor'`.

- [ ] **Step 1: Escrever a migração**

```sql
-- infra/sql/tenant/034_fluxo_vendas.sql
-- Fluxo Vendas, fase 1 (09/11/2026): vendedor externo tira pedido e orçamento pelo app.
--  * vendedores e cliente_vendedor (carteira) chegam do ERP;
--  * tabela_preco_condicoes diz quais condições de pagamento cada tabela aceita;
--  * orcamentos fica FORA de pedidos: o ERP importa tudo que está em pedidos;
--  * pedidos ganha o vendedor, a tabela e a condição usadas e o id gerado no aparelho
--    (reenvio do mesmo pedido não duplica);
--  * AGUARDANDO_VENDEDOR = pedido retido por divergência de preço, estoque ou crédito.

create table if not exists vendedores (
  id              uuid primary key default gen_random_uuid(),
  erp_vendedor_id text not null unique,
  nome            text not null,
  filial          text,
  login           text unique,                 -- definido na retaguarda; nulo = ainda sem acesso
  senha_hash      text,                        -- argon2id
  ativo           boolean not null default true,
  ultima_sync_em  timestamptz,
  app_versao      text,
  criado_em       timestamptz not null default now()
);

create table if not exists cliente_vendedor (
  cliente_id  uuid not null references clientes(id),
  vendedor_id uuid not null references vendedores(id),
  primary key (cliente_id, vendedor_id)
);
create index if not exists idx_cliente_vendedor_vendedor on cliente_vendedor (vendedor_id);

create table if not exists tabela_preco_condicoes (
  tabela_preco_id       uuid not null references tabelas_preco(id),
  condicao_pagamento_id uuid not null references condicoes_pagamento_erp(id),
  primary key (tabela_preco_id, condicao_pagamento_id)
);

create table if not exists orcamentos (
  id                    uuid primary key,      -- gerado no aparelho
  vendedor_id           uuid not null references vendedores(id),
  cliente_id            uuid not null references clientes(id),
  tabela_preco_id       uuid not null references tabelas_preco(id),
  condicao_pagamento_id uuid references condicoes_pagamento_erp(id),
  tipo_entrega          text not null default 'entrega' check (tipo_entrega in ('entrega','retirada')),
  observacoes           text,
  total                 numeric(12,2) not null,
  status                text not null default 'aberto' check (status in ('aberto','convertido','cancelado')),
  pedido_id             uuid references pedidos(id),
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);
create index if not exists idx_orcamentos_vendedor on orcamentos (vendedor_id, status);

create table if not exists orcamento_itens (
  orcamento_id uuid not null references orcamentos(id) on delete cascade,
  produto_id   uuid not null references produtos(id),
  quantidade   numeric(10,3) not null,
  preco_unit   numeric(12,2) not null,
  primary key (orcamento_id, produto_id)
);

alter table pedidos add column if not exists vendedor_id uuid references vendedores(id);
alter table pedidos add column if not exists origem text not null default 'app_cliente';
alter table pedidos drop constraint if exists pedidos_origem_check;
alter table pedidos add constraint pedidos_origem_check check (origem in ('app_cliente','vendedor'));
alter table pedidos add column if not exists tabela_preco_id uuid references tabelas_preco(id);
alter table pedidos add column if not exists condicao_pagamento_id uuid references condicoes_pagamento_erp(id);
alter table pedidos add column if not exists id_dispositivo uuid;
alter table pedidos add column if not exists retencao_json jsonb;
alter table pedidos add column if not exists criado_no_aparelho_em timestamptz;
create unique index if not exists uq_pedidos_id_dispositivo on pedidos (id_dispositivo) where id_dispositivo is not null;
create index if not exists idx_pedidos_vendedor on pedidos (vendedor_id, criado_em desc) where vendedor_id is not null;

alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('AGUARDANDO_PAGAMENTO','AGUARDANDO_VENDEDOR','RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO','FATURADO',
                    'EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO'));

alter table refresh_tokens drop constraint if exists refresh_tokens_sujeito_check;
alter table refresh_tokens add constraint refresh_tokens_sujeito_check
  check (sujeito in ('cliente','admin','vendedor'));

insert into schema_migrations (versao) values ('034') on conflict do nothing;
```

- [ ] **Step 2: Conferir a lista de status contra a migração anterior**

Run: `grep -n "AGUARDANDO_PAGAMENTO" infra/sql/tenant/03*.sql`
Expected: a lista da 030 (`AGUARDANDO_PAGAMENTO, RECEBIDO, ENVIADO_ERP, ABERTO, EM_FATURAMENTO, FATURADO, EM_SEPARACAO, SAIU_ENTREGA, ENTREGUE, FALHA_INTEGRACAO, CANCELADO`). Se a 032 ou a 033 tiverem acrescentado algum status em `pedidos`, inclua-o também na 034 antes de seguir.

- [ ] **Step 3: Aplicar no banco de desenvolvimento, se houver PostgreSQL local**

Run (PowerShell): `$env:PGPASSWORD='postgres'; psql -U postgres -d fluxo_t_cahu -v ON_ERROR_STOP=1 -f infra/sql/tenant/034_fluxo_vendas.sql`
Expected: sequência de `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` e `INSERT 0 1`, sem `ERROR`. Rodar uma segunda vez deve terminar igual, sem erro (a migração é repetível). Se não houver PostgreSQL local, registre no relatório da tarefa que a migração não foi executada.

- [ ] **Step 4: Copiar o espelho e commitar**

```bash
cp infra/sql/tenant/034_fluxo_vendas.sql "../11 - SQL/tenant/034_fluxo_vendas.sql"
git add infra/sql/tenant/034_fluxo_vendas.sql
git commit -m "Vendas: migração 034 (vendedores, carteira, orçamentos, pedido do vendedor)"
```

---

### Task 2: ERP envia vendedores e carteira

**Files:**
- Create: `apps/api/src/integracoes-dlinks/funcionario.dto.ts`
- Create: `apps/api/src/integracoes-dlinks/cliente-funcionario.dto.ts`
- Create: `apps/api/src/integracoes-dlinks/dlinks-vendedores.service.ts`
- Create: `apps/api/src/integracoes-dlinks/dlinks-vendedores.controller.ts`
- Modify: `apps/api/src/integracoes-dlinks/dlinks.module.ts`
- Test: `apps/api/src/integracoes-dlinks/dlinks-vendedores.spec.ts`

**Interfaces:**
- Consumes: tabelas da Task 1; `ListaOuItemPipe`, `ResultadoSync` (de `dlinks-sync.service.ts`), `tenantCtx`.
- Produces: `POST /v1/integracoes/dlinks/funcionarios` e `POST /v1/integracoes/dlinks/clientes-funcionarios`, ambos aceitando item único ou lista, respondendo `{ processados, ignorados }`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/integracoes-dlinks/dlinks-vendedores.spec.ts
import { runComTenant } from '../tenancy/tenant-context';
import { DlinksVendedoresService } from './dlinks-vendedores.service';

function montar(clientes: Record<string, string>, vendedores: Record<string, string>) {
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('from clientes where erp_cliente_id')) {
      const id = clientes[String(params[0])];
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.includes('from vendedores where erp_vendedor_id')) {
      const id = vendedores[String(params[0])];
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  return { query, pool };
}

const rodar = <T>(pool: unknown, fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);

describe('DlinksVendedoresService', () => {
  it('grava o vendedor pelo código do ERP sem apagar o ativo quando o campo não vem', async () => {
    const { query, pool } = montar({}, {});
    const out = await rodar(pool, () => new DlinksVendedoresService().syncFuncionarios([{ codigo: '6', nome: 'Vendedor Seis' }] as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into vendedores'));
    expect(String(insert![0])).toContain('on conflict (erp_vendedor_id)');
    expect(String(insert![0])).toContain('ativo = coalesce($4::boolean, vendedores.ativo)');
    expect(insert![1]).toEqual(['6', 'Vendedor Seis', null, null]);
    expect(out).toEqual({ processados: 1, ignorados: [] });
  });

  it('substitui a carteira dos clientes enviados e ignora códigos desconhecidos', async () => {
    const { query, pool } = montar({ C1: 'cli-1' }, { '6': 'vend-6' });
    const out = await rodar(pool, () =>
      new DlinksVendedoresService().syncCarteira([
        { cliente_codigo: 'C1', funcionario_codigo: '6' },
        { cliente_codigo: 'C9', funcionario_codigo: '6' },
        { cliente_codigo: 'C1', funcionario_codigo: '99' },
      ] as never),
    );
    const apagar = query.mock.calls.find(([sql]) => String(sql).includes('delete from cliente_vendedor'));
    expect(apagar![1]).toEqual([['cli-1']]);
    const inserir = query.mock.calls.filter(([sql]) => String(sql).includes('insert into cliente_vendedor'));
    expect(inserir).toHaveLength(1);
    expect(inserir[0][1]).toEqual(['cli-1', 'vend-6']);
    expect(out.processados).toBe(1);
    expect(out.ignorados.map((i) => i.motivo)).toEqual(['cliente_nao_encontrado', 'funcionario_nao_encontrado']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- dlinks-vendedores.spec`
Expected: FAIL com `Cannot find module './dlinks-vendedores.service'`.

- [ ] **Step 3: Escrever os DTOs**

```ts
// apps/api/src/integracoes-dlinks/funcionario.dto.ts
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class FuncionarioDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsOptional()
  @IsString()
  filial_codigo?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
```

```ts
// apps/api/src/integracoes-dlinks/cliente-funcionario.dto.ts
import { IsString } from 'class-validator';

export class ClienteFuncionarioDto {
  @IsString()
  cliente_codigo!: string;

  @IsString()
  funcionario_codigo!: string;
}
```

- [ ] **Step 4: Escrever o serviço**

```ts
// apps/api/src/integracoes-dlinks/dlinks-vendedores.service.ts
import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import type { ResultadoSync } from './dlinks-sync.service';
import { FuncionarioDto } from './funcionario.dto';

@Injectable()
export class DlinksVendedoresService {
  private async registrarLog(operacao: string, resumo: string, sucesso: boolean) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,$3)`,
      [operacao, resumo, sucesso],
    );
  }

  /** Vendedor é identificado pelo código do ERP. `ativo` ausente não mexe no que a retaguarda definiu. */
  async syncFuncionarios(itens: FuncionarioDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into vendedores (erp_vendedor_id, nome, filial, ativo)
         values ($1, $2, $3, coalesce($4::boolean, true))
         on conflict (erp_vendedor_id) do update set
           nome = excluded.nome,
           filial = coalesce(excluded.filial, vendedores.filial),
           ativo = coalesce($4::boolean, vendedores.ativo)`,
        [item.codigo, item.nome, item.filial_codigo ?? null, item.ativo ?? null],
      );
      processados++;
    }
    await this.registrarLog('sync_funcionarios', `${processados} vendedor(es)`, true);
    return { processados, ignorados: [] };
  }

  /**
   * O lote manda nos clientes que cita: os vínculos antigos desses clientes são
   * apagados e os do lote entram. Cliente que não aparece no lote não é tocado.
   */
  async syncCarteira(itens: ClienteFuncionarioDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    const pares: Array<[string, string]> = [];
    for (const item of itens) {
      const cli = await pool.query(`select id from clientes where erp_cliente_id = $1`, [item.cliente_codigo]);
      if (!cli.rowCount) {
        ignorados.push({ item, motivo: 'cliente_nao_encontrado' });
        continue;
      }
      const vend = await pool.query(`select id from vendedores where erp_vendedor_id = $1`, [item.funcionario_codigo]);
      if (!vend.rowCount) {
        ignorados.push({ item, motivo: 'funcionario_nao_encontrado' });
        continue;
      }
      pares.push([cli.rows[0].id, vend.rows[0].id]);
    }
    if (pares.length) {
      const clientes = [...new Set(pares.map(([c]) => c))];
      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(`delete from cliente_vendedor where cliente_id = any($1::uuid[])`, [clientes]);
        for (const [clienteId, vendedorId] of pares) {
          await client.query(
            `insert into cliente_vendedor (cliente_id, vendedor_id) values ($1, $2) on conflict do nothing`,
            [clienteId, vendedorId],
          );
        }
        await client.query('commit');
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    }
    await this.registrarLog('sync_carteira', `${pares.length} vínculo(s), ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados: pares.length, ignorados };
  }
}
```

- [ ] **Step 5: Escrever o controller e registrar no módulo**

```ts
// apps/api/src/integracoes-dlinks/dlinks-vendedores.controller.ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import { DlinksVendedoresService } from './dlinks-vendedores.service';
import { FuncionarioDto } from './funcionario.dto';
import { ListaOuItemPipe } from './lista-ou-item.pipe';

@Controller('integracoes/dlinks')
export class DlinksVendedoresController {
  constructor(private readonly service: DlinksVendedoresService) {}

  @Post('funcionarios')
  @HttpCode(200)
  funcionarios(@Body(new ListaOuItemPipe(FuncionarioDto)) itens: FuncionarioDto[]) {
    return this.service.syncFuncionarios(itens);
  }

  @Post('clientes-funcionarios')
  @HttpCode(200)
  carteira(@Body(new ListaOuItemPipe(ClienteFuncionarioDto)) itens: ClienteFuncionarioDto[]) {
    return this.service.syncCarteira(itens);
  }
}
```

Em `apps/api/src/integracoes-dlinks/dlinks.module.ts`, o módulo passa a ser:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DlinksAuthMiddleware } from './dlinks-auth.middleware';
import { DlinksPedidosController } from './dlinks-pedidos.controller';
import { DlinksPedidosService } from './dlinks-pedidos.service';
import { DlinksSyncController } from './dlinks-sync.controller';
import { DlinksSyncService } from './dlinks-sync.service';
import { DlinksVendedoresController } from './dlinks-vendedores.controller';
import { DlinksVendedoresService } from './dlinks-vendedores.service';

@Module({
  controllers: [DlinksPedidosController, DlinksSyncController, DlinksVendedoresController],
  providers: [DlinksPedidosService, DlinksSyncService, DlinksVendedoresService],
})
export class DlinksModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(DlinksAuthMiddleware).forRoutes(DlinksPedidosController, DlinksSyncController, DlinksVendedoresController);
  }
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test -w apps/api -- dlinks-vendedores.spec`
Expected: PASS, 2 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/integracoes-dlinks
git commit -m "Vendas: ERP envia vendedores e carteira (funcionarios, clientes-funcionarios)"
```

---

### Task 3: Login do vendedor e proteção das rotas

**Files:**
- Create: `apps/api/src/vendas/vendedor.guard.ts`
- Create: `apps/api/src/vendas/vendas-auth.service.ts`
- Create: `apps/api/src/vendas/vendas-auth.controller.ts`
- Create: `apps/api/src/vendas/vendas.module.ts`
- Modify: `apps/api/src/app.module.ts` (importar `VendasModule`)
- Modify: `apps/api/src/auth/auth.service.ts` (método `refresh`: aceitar só token de cliente)
- Test: `apps/api/src/vendas/vendedor.guard.spec.ts`, `apps/api/src/vendas/vendas-auth.spec.ts`

**Interfaces:**
- Consumes: `JwtService` e `LimiteAuthService` (exportados pelo `AuthModule`, que é global), `ipDaRequisicao`, `tenantCtx`.
- Produces:
  - `interface VendedorLogado { vendedorId: string }`, anexado em `req.vendedor` pelo `VendedorGuard`.
  - `POST /v1/vendas/login` body `{ login, senha }` → `{ accessToken, refreshToken, vendedor: { id, nome }, distribuidora }`.
  - `POST /v1/vendas/refresh` body `{ refreshToken }` → `{ accessToken, refreshToken }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/vendas/vendedor.guard.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { VendedorGuard } from './vendedor.guard';

const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU', adaptadorErp: 'dlinks' };

function contexto(authorization?: string) {
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return { req, ctx: { switchToHttp: () => ({ getRequest: () => req }) } as never };
}

function rodar(payload: unknown, ativo: boolean, authorization = 'Bearer abc') {
  const jwt = { verifyAsync: jest.fn(async () => { if (!payload) throw new Error('inválido'); return payload; }) };
  const query = jest.fn(async () => ({ rows: ativo ? [{ ok: 1 }] : [], rowCount: ativo ? 1 : 0 }));
  const { req, ctx } = contexto(authorization);
  const guard = new VendedorGuard(jwt as never);
  return { req, promessa: runComTenant({ tenant, pool: { query } } as never, () => guard.canActivate(ctx)) };
}

describe('VendedorGuard', () => {
  it('aceita token de vendedor ativo do mesmo tenant e anexa req.vendedor', async () => {
    const { req, promessa } = rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, true);
    await expect(promessa).resolves.toBe(true);
    expect(req.vendedor).toEqual({ vendedorId: 'v1' });
  });

  it('recusa token de cliente', async () => {
    await expect(rodar({ sub: 'c1', slug: 'cahu', tipo: 'cliente' }, true).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token de outro tenant', async () => {
    await expect(rodar({ sub: 'v1', slug: 'outra', tipo: 'vendedor' }, true).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa vendedor desativado', async () => {
    await expect(rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, false).promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa requisição sem Authorization', async () => {
    await expect(rodar({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' }, true, '').promessa).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

```ts
// apps/api/src/vendas/vendas-auth.spec.ts
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runComTenant } from '../tenancy/tenant-context';
import { VendasAuthService } from './vendas-auth.service';

const tenant = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU Distribuidora', appNome: 'CAHU', adaptadorErp: 'dlinks' };

function montar(vendedor: Record<string, unknown> | null) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from vendedores where login')) return { rows: vendedor ? [vendedor] : [], rowCount: vendedor ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  });
  const jwt = { signAsync: jest.fn(async () => 'token-de-acesso') };
  const limite = { conferir: jest.fn(), registrarFalha: jest.fn(), limpar: jest.fn() };
  const servico = new VendasAuthService(jwt as never, limite as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant, pool: { query } } as never, fn);
  return { servico, query, jwt, limite, rodar };
}

describe('VendasAuthService.login', () => {
  it('entra com login e senha corretos e emite token do tipo vendedor', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, jwt, query, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: true });
    const out = await rodar(() => servico.login(' ANA ', 'segredo123', '1.1.1.1'));
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: 'v1', slug: 'cahu', tipo: 'vendedor' });
    expect(out.accessToken).toBe('token-de-acesso');
    expect(out.refreshToken.length).toBeGreaterThan(40);
    expect(out.vendedor).toEqual({ id: 'v1', nome: 'Ana' });
    const consulta = query.mock.calls.find(([sql]) => String(sql).includes('from vendedores where login'));
    expect(consulta![1]).toEqual(['ana']);
    const refresh = query.mock.calls.find(([sql]) => String(sql).includes('insert into refresh_tokens'));
    expect(String(refresh![0])).toContain("'vendedor'");
  });

  it('recusa senha errada e conta a falha', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, limite, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: true });
    await expect(rodar(() => servico.login('ana', 'errada', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(limite.registrarFalha).toHaveBeenCalledWith(['vend:ana', 'ip:1.1.1.1']);
  });

  it('recusa vendedor desativado mesmo com a senha certa', async () => {
    const senha_hash = await argon2.hash('segredo123');
    const { servico, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash, ativo: false });
    await expect(rodar(() => servico.login('ana', 'segredo123', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa vendedor que ainda não tem senha definida', async () => {
    const { servico, rodar } = montar({ id: 'v1', nome: 'Ana', senha_hash: null, ativo: true });
    await expect(rodar(() => servico.login('ana', 'qualquer', '1.1.1.1'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/vendedor.guard.spec vendas/vendas-auth.spec`
Expected: FAIL com `Cannot find module './vendedor.guard'` e `'./vendas-auth.service'`.

- [ ] **Step 3: Escrever o guard**

```ts
// apps/api/src/vendas/vendedor.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

export interface VendedorLogado {
  vendedorId: string;
}

/**
 * Exige vendedor autenticado (token tipo 'vendedor' do mesmo tenant) e ainda ativo.
 * A consulta ao banco a cada request faz a desativação na retaguarda valer na hora.
 */
@Injectable()
export class VendedorGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { vendedor?: VendedorLogado }>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: { sub: string; slug: string; tipo: string };
    try {
      payload = await this.jwt.verifyAsync(auth.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    const { pool, tenant } = tenantCtx();
    if (payload.tipo !== 'vendedor' || payload.slug !== tenant.slug) throw new UnauthorizedException();
    const { rowCount } = await pool.query(`select 1 from vendedores where id = $1 and ativo`, [payload.sub]);
    if (!rowCount) throw new UnauthorizedException({ statusCode: 401, message: 'Acesso desativado', codigo: 'VENDEDOR_DESATIVADO' });
    req.vendedor = { vendedorId: payload.sub };
    return true;
  }
}
```

- [ ] **Step 4: Escrever o serviço de autenticação**

```ts
// apps/api/src/vendas/vendas-auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { LimiteAuthService } from '../auth/limite-auth.service';
import { tenantCtx } from '../tenancy/tenant-context';

/** Vendedor trabalha offline: a sessão sobrevive 30 dias sem falar com o servidor. */
const REFRESH_DIAS_VENDEDOR = 30;

export interface TokensVendedor {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class VendasAuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly limite: LimiteAuthService,
  ) {}

  async login(loginInformado: string, senha: string, ip: string) {
    const { pool, tenant } = tenantCtx();
    const login = loginInformado.trim().toLowerCase();
    const chaves = [`vend:${login}`, `ip:${ip}`];
    await this.limite.conferir(chaves);
    const { rows } = await pool.query(`select id, nome, senha_hash, ativo from vendedores where login = $1`, [login]);
    const v = rows[0];
    if (!v || !v.ativo || !v.senha_hash || !(await argon2.verify(v.senha_hash, senha))) {
      await this.limite.registrarFalha(chaves);
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }
    await this.limite.limpar(chaves[0]);
    const tokens = await this.emitir(v.id, tenant.slug);
    return { ...tokens, vendedor: { id: v.id, nome: v.nome }, distribuidora: tenant.nomeFantasia };
  }

  /** Mesma rotação com tolerância de 30 s do app do cliente, restrita a tokens de vendedor ativo. */
  async refresh(refreshToken: string): Promise<TokensVendedor> {
    const { pool, tenant } = tenantCtx();
    const hash = createHash('sha256').update(refreshToken).digest('hex');
    const { rows } = await pool.query(
      `update refresh_tokens r set revogado_em = coalesce(r.revogado_em, now())
         from vendedores v
        where r.token_hash = $1 and r.sujeito = 'vendedor' and r.expira_em > now()
          and (r.revogado_em is null or r.revogado_em > now() - interval '30 seconds')
          and v.id = r.sujeito_id and v.ativo
        returning r.sujeito_id`,
      [hash],
    );
    if (!rows[0]) throw new UnauthorizedException('Sessão expirada. Entre novamente.');
    return this.emitir(rows[0].sujeito_id, tenant.slug);
  }

  private async emitir(vendedorId: string, slug: string): Promise<TokensVendedor> {
    const { pool } = tenantCtx();
    const refreshToken = randomBytes(48).toString('base64url');
    await pool.query(
      `insert into refresh_tokens (sujeito_id, sujeito, token_hash, expira_em)
       values ($1,'vendedor',$2, now() + interval '${REFRESH_DIAS_VENDEDOR} days')`,
      [vendedorId, createHash('sha256').update(refreshToken).digest('hex')],
    );
    const accessToken = await this.jwt.signAsync({ sub: vendedorId, slug, tipo: 'vendedor' });
    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 5: Escrever o controller de autenticação e o módulo**

```ts
// apps/api/src/vendas/vendas-auth.controller.ts
import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import type { Request } from 'express';
import { ipDaRequisicao } from '../auth/limite-auth.service';
import { VendasAuthService } from './vendas-auth.service';

class LoginVendedorDto {
  @IsString() @IsNotEmpty() login!: string;
  @IsString() @IsNotEmpty() senha!: string;
}

class RefreshVendedorDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

@Controller('vendas')
export class VendasAuthController {
  constructor(private readonly auth: VendasAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request, @Body() dto: LoginVendedorDto) {
    return this.auth.login(dto.login, dto.senha, ipDaRequisicao(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshVendedorDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}
```

```ts
// apps/api/src/vendas/vendas.module.ts
import { Module } from '@nestjs/common';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController],
  providers: [VendasAuthService, VendedorGuard],
})
export class VendasModule {}
```

Em `apps/api/src/app.module.ts`, acrescentar o import e incluir `VendasModule` no fim da lista de `imports`:

```ts
import { VendasModule } from './vendas/vendas.module';
```

```ts
  imports: [DatabaseModule, IntegrationModule, AuthModule, CatalogModule, OrdersModule, ProfileModule, AdminModule, DlinksModule, GeoModule, MaxipagoModule, MunicipiosModule, NotasModule, PagamentosModule, VendasModule],
```

- [ ] **Step 6: Impedir que token de vendedor renove sessão de cliente**

Em `apps/api/src/auth/auth.service.ts`, no método `refresh`, a consulta ganha o filtro de sujeito. Trocar:

```ts
        where token_hash = $1 and expira_em > now()
```

por:

```ts
        where token_hash = $1 and sujeito = 'cliente' and expira_em > now()
```

- [ ] **Step 7: Rodar os testes**

Run: `npm test -w apps/api -- vendas/ auth/`
Expected: PASS em `vendedor.guard.spec` (5), `vendas-auth.spec` (4) e em todos os testes existentes de `auth/`.

- [ ] **Step 8: Conferir que a API compila**

Run: `npm run build -w apps/api`
Expected: termina sem erro de TypeScript.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/vendas apps/api/src/app.module.ts apps/api/src/auth/auth.service.ts
git commit -m "Vendas: login e renovação de sessão do vendedor, guard das rotas"
```

---

### Task 4: Carga de dados para o celular

**Files:**
- Create: `apps/api/src/vendas/vendas-sync.service.ts`
- Create: `apps/api/src/vendas/vendas.controller.ts`
- Modify: `apps/api/src/vendas/vendas.module.ts`
- Test: `apps/api/src/vendas/vendas-sync.spec.ts`

**Interfaces:**
- Consumes: `VendedorGuard`, `VendedorLogado`.
- Produces: `GET /v1/vendas/sync` (header opcional `X-App-Versao`) → objeto `CargaVendedor` definido abaixo. O plano do app depende exatamente destes nomes de campo.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/vendas/vendas-sync.spec.ts
import { runComTenant } from '../tenancy/tenant-context';
import { VendasSyncService } from './vendas-sync.service';

describe('VendasSyncService.carga', () => {
  it('devolve só a carteira do vendedor, converte números e registra a sincronização', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from vendedores where id')) return { rows: [{ id: 'v1', nome: 'Ana', erp_vendedor_id: '6' }] };
      if (sql.includes('/* clientes */')) {
        return { rows: [{ id: 'c1', erp_cliente_id: '10', documento: '123', razao_social: 'R', nome_fantasia: 'F', telefone: null,
          status: 'aprovado', limite_credito: '20000.00', em_aberto: '5700.00', endereco: { cidade: 'Recife' } }] };
      }
      if (sql.includes('/* precos */')) return { rows: [{ produto_id: 'p1', tabela_preco_id: 't1', preco: '86.40' }] };
      if (sql.includes('/* produtos */')) {
        return { rows: [{ id: 'p1', sku: '1', ean: '789', nome: 'Margarina', unidade_venda: 'CX', qtd_por_embalagem: '12.000',
          categoria_id: null, estoque: '186.000', imagem_url: null }] };
      }
      return { rows: [] };
    });
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasSyncService().carga('v1', '1.0.0'));

    const clientes = query.mock.calls.find(([sql]) => String(sql).includes('/* clientes */'));
    expect(String(clientes![0])).toContain('cv.vendedor_id = $1');
    expect(clientes![1]).toEqual(['v1']);
    expect(out.vendedor).toEqual({ id: 'v1', nome: 'Ana', erpVendedorId: '6' });
    expect(out.clientes[0]).toEqual(expect.objectContaining({ id: 'c1', limiteCredito: 20000, emAberto: 5700, endereco: { cidade: 'Recife' } }));
    expect(out.precos[0]).toEqual({ produtoId: 'p1', tabelaId: 't1', preco: 86.4 });
    expect(out.produtos[0]).toEqual(expect.objectContaining({ qtdPorEmbalagem: 12, estoque: 186 }));
    expect(typeof out.geradoEm).toBe('string');
    const registro = query.mock.calls.find(([sql]) => String(sql).includes('update vendedores set ultima_sync_em'));
    expect(registro![1]).toEqual(['v1', '1.0.0']);
  });

  it('mantém limite nulo quando o ERP ainda não enviou', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from vendedores where id')) return { rows: [{ id: 'v1', nome: 'Ana', erp_vendedor_id: '6' }] };
      if (sql.includes('/* clientes */')) {
        return { rows: [{ id: 'c1', erp_cliente_id: null, documento: '1', razao_social: null, nome_fantasia: 'F', telefone: null,
          status: 'aprovado', limite_credito: null, em_aberto: '0', endereco: null }] };
      }
      return { rows: [] };
    });
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasSyncService().carga('v1'));
    expect(out.clientes[0].limiteCredito).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/vendas-sync.spec`
Expected: FAIL com `Cannot find module './vendas-sync.service'`.

- [ ] **Step 3: Escrever o serviço**

```ts
// apps/api/src/vendas/vendas-sync.service.ts
import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';

const n = (v: unknown): number => Number(v);
const nOuNulo = (v: unknown): number | null => (v == null ? null : Number(v));

export interface CargaVendedor {
  geradoEm: string;
  vendedor: { id: string; nome: string; erpVendedorId: string };
  clientes: Array<{
    id: string; erpClienteId: string | null; documento: string; razaoSocial: string | null; nomeFantasia: string;
    telefone: string | null; status: string; limiteCredito: number | null; emAberto: number;
    endereco: Record<string, unknown> | null;
  }>;
  titulos: Array<{ clienteId: string; numero: string; valor: number; vencimento: string; status: string }>;
  tabelas: Array<{ id: string; nome: string; erpTabelaId: string }>;
  formas: Array<{ id: string; descricao: string }>;
  condicoes: Array<{ id: string; descricao: string; formaId: string }>;
  tabelaCondicoes: Array<{ tabelaId: string; condicaoId: string }>;
  categorias: Array<{ id: string; nome: string }>;
  produtos: Array<{
    id: string; sku: string; ean: string | null; nome: string; unidade: string; qtdPorEmbalagem: number;
    categoriaId: string | null; estoque: number; imagemUrl: string | null;
  }>;
  precos: Array<{ produtoId: string; tabelaId: string; preco: number }>;
  historico: Array<{
    pedidoId: string; numero: number; clienteId: string; criadoEm: string; total: number; status: string;
    itens: Array<{ produtoId: string; quantidade: number; precoUnit: number }>;
  }>;
}

/**
 * Carga COMPLETA do que o vendedor precisa para trabalhar offline. O app troca a
 * cópia local inteira a cada sincronização — sem controle de alterações nem de exclusões.
 */
@Injectable()
export class VendasSyncService {
  async carga(vendedorId: string, appVersao?: string): Promise<CargaVendedor> {
    const { pool } = tenantCtx();
    const vend = await pool.query(`select id, nome, erp_vendedor_id from vendedores where id = $1`, [vendedorId]);

    const clientes = await pool.query(
      `/* clientes */
       select c.id, c.erp_cliente_id, c.documento, c.razao_social, c.nome_fantasia, c.telefone, c.status, c.limite_credito,
              (select coalesce(sum(t.valor),0) from titulos_cliente t where t.cliente_id = c.id and t.status = 'ABERTO') as em_aberto,
              (select row_to_json(e) from (
                 select e2.logradouro, e2.numero, e2.complemento, e2.bairro, e2.cidade, e2.uf, e2.cep
                   from cliente_enderecos e2 where e2.cliente_id = c.id order by e2.padrao desc limit 1) e) as endereco
         from clientes c join cliente_vendedor cv on cv.cliente_id = c.id
        where cv.vendedor_id = $1 and c.status <> 'excluido'
        order by c.nome_fantasia`,
      [vendedorId],
    );
    const titulos = await pool.query(
      `/* titulos */
       select t.cliente_id, t.erp_titulo_id, t.valor, t.vencimento, t.status
         from titulos_cliente t join cliente_vendedor cv on cv.cliente_id = t.cliente_id
        where cv.vendedor_id = $1 and t.status = 'ABERTO'
        order by t.vencimento`,
      [vendedorId],
    );
    const tabelas = await pool.query(
      `/* tabelas */ select id, nome, erp_tabela_id from tabelas_preco where erp_tabela_id is not null order by nome`,
    );
    const formas = await pool.query(`/* formas */ select id, descricao from formas_pagamento_erp order by descricao`);
    const condicoes = await pool.query(
      `/* condicoes */ select id, descricao, forma_pagamento_id from condicoes_pagamento_erp order by descricao`,
    );
    const tabelaCondicoes = await pool.query(
      `/* tabela_condicoes */ select tabela_preco_id, condicao_pagamento_id from tabela_preco_condicoes`,
    );
    const categorias = await pool.query(`/* categorias */ select id, nome from categorias where ativo order by ordem, nome`);
    const produtos = await pool.query(
      `/* produtos */
       select p.id, p.sku, p.ean, p.nome, p.unidade_venda, p.qtd_por_embalagem, p.categoria_id,
              coalesce(e.quantidade,0) as estoque,
              (select coalesce(pi.url_miniatura, pi.url) from produto_imagens pi where pi.produto_id = p.id order by pi.ordem limit 1) as imagem_url
         from produtos p left join estoques e on e.produto_id = p.id
        where p.ativo
        order by p.nome`,
    );
    const precos = await pool.query(
      `/* precos */
       select pr.produto_id, pr.tabela_preco_id, pr.preco
         from precos pr join produtos p on p.id = pr.produto_id
        where p.ativo`,
    );
    const historico = await pool.query(
      `/* historico */
       select p.id, p.numero, p.cliente_id, p.criado_em, p.total, p.status,
              (select json_agg(json_build_object('produtoId', i.produto_id, 'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i where i.pedido_id = p.id) as itens
         from pedidos p join cliente_vendedor cv on cv.cliente_id = p.cliente_id
        where cv.vendedor_id = $1 and p.criado_em > now() - interval '90 days'
          and p.status not in ('CANCELADO','AGUARDANDO_PAGAMENTO','AGUARDANDO_VENDEDOR')
        order by p.criado_em desc`,
      [vendedorId],
    );

    await pool.query(
      `update vendedores set ultima_sync_em = now(), app_versao = coalesce($2, app_versao) where id = $1`,
      [vendedorId, appVersao ?? null],
    );

    const v = vend.rows[0];
    return {
      geradoEm: new Date().toISOString(),
      vendedor: { id: v.id, nome: v.nome, erpVendedorId: v.erp_vendedor_id },
      clientes: clientes.rows.map((c) => ({
        id: c.id, erpClienteId: c.erp_cliente_id, documento: c.documento, razaoSocial: c.razao_social,
        nomeFantasia: c.nome_fantasia, telefone: c.telefone, status: c.status,
        limiteCredito: nOuNulo(c.limite_credito), emAberto: n(c.em_aberto), endereco: c.endereco ?? null,
      })),
      titulos: titulos.rows.map((t) => ({
        clienteId: t.cliente_id, numero: t.erp_titulo_id, valor: n(t.valor), vencimento: t.vencimento, status: t.status,
      })),
      tabelas: tabelas.rows.map((t) => ({ id: t.id, nome: t.nome, erpTabelaId: t.erp_tabela_id })),
      formas: formas.rows.map((f) => ({ id: f.id, descricao: f.descricao })),
      condicoes: condicoes.rows.map((c) => ({ id: c.id, descricao: c.descricao, formaId: c.forma_pagamento_id })),
      tabelaCondicoes: tabelaCondicoes.rows.map((x) => ({ tabelaId: x.tabela_preco_id, condicaoId: x.condicao_pagamento_id })),
      categorias: categorias.rows.map((c) => ({ id: c.id, nome: c.nome })),
      produtos: produtos.rows.map((p) => ({
        id: p.id, sku: p.sku, ean: p.ean, nome: p.nome, unidade: p.unidade_venda, qtdPorEmbalagem: n(p.qtd_por_embalagem),
        categoriaId: p.categoria_id, estoque: n(p.estoque), imagemUrl: p.imagem_url,
      })),
      precos: precos.rows.map((p) => ({ produtoId: p.produto_id, tabelaId: p.tabela_preco_id, preco: n(p.preco) })),
      historico: historico.rows.map((h) => ({
        pedidoId: h.id, numero: n(h.numero), clienteId: h.cliente_id, criadoEm: h.criado_em, total: n(h.total), status: h.status,
        itens: (h.itens ?? []).map((i: { produtoId: string; quantidade: unknown; precoUnit: unknown }) => ({
          produtoId: i.produtoId, quantidade: n(i.quantidade), precoUnit: n(i.precoUnit),
        })),
      })),
    };
  }
}
```

- [ ] **Step 4: Criar o controller das rotas do app e registrar**

```ts
// apps/api/src/vendas/vendas.controller.ts
import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { VendasSyncService } from './vendas-sync.service';
import { VendedorGuard, VendedorLogado } from './vendedor.guard';

type ReqVendedor = Request & { vendedor: VendedorLogado };

@Controller('vendas')
@UseGuards(VendedorGuard)
export class VendasController {
  constructor(private readonly sync: VendasSyncService) {}

  @Get('sync')
  carga(@Req() req: ReqVendedor, @Headers('x-app-versao') appVersao?: string) {
    return this.sync.carga(req.vendedor.vendedorId, appVersao);
  }
}
```

`apps/api/src/vendas/vendas.module.ts` passa a ser:

```ts
import { Module } from '@nestjs/common';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendasController } from './vendas.controller';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController, VendasController],
  providers: [VendasAuthService, VendedorGuard, VendasSyncService],
})
export class VendasModule {}
```

- [ ] **Step 5: Rodar os testes e compilar**

Run: `npm test -w apps/api -- vendas/vendas-sync.spec && npm run build -w apps/api`
Expected: PASS, 2 testes; build sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/vendas
git commit -m "Vendas: carga completa de dados para o app do vendedor (GET /vendas/sync)"
```

---

### Task 5: Regra de divergência do pedido

**Files:**
- Create: `apps/api/src/vendas/conferir-pedido.ts`
- Test: `apps/api/src/vendas/conferir-pedido.spec.ts`

**Interfaces:**
- Produces:

```ts
export interface ItemRecebido { produtoId: string; quantidade: number; precoUnit: number }
export interface DadosAtuais {
  precos: Map<string, number>;      // produtoId -> preço atual na tabela escolhida (ausente = sem preço nessa tabela)
  estoques: Map<string, number>;    // produtoId -> estoque atual
  nomes: Map<string, string>;       // produtoId -> nome
  creditoDisponivel: number | null; // null = ERP ainda não informou limite
  exigeCredito: boolean;            // false para pagamento à vista
}
export interface Divergencia {
  tipo: 'preco' | 'sem_preco' | 'estoque' | 'credito';
  produtoId?: string; nome?: string; enviado?: number; atual?: number;
}
export function conferirPedido(itens: ItemRecebido[], dados: DadosAtuais): { divergencias: Divergencia[]; totalAtual: number };
export function arredondar(valor: number): number;
```

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/vendas/conferir-pedido.spec.ts
import { conferirPedido, DadosAtuais } from './conferir-pedido';

function dados(parcial: Partial<DadosAtuais> = {}): DadosAtuais {
  return {
    precos: new Map([['p1', 86.4], ['p2', 31]]),
    estoques: new Map([['p1', 100], ['p2', 100]]),
    nomes: new Map([['p1', 'Margarina'], ['p2', 'Açúcar']]),
    creditoDisponivel: 10000,
    exigeCredito: true,
    ...parcial,
  };
}

describe('conferirPedido', () => {
  it('não acusa nada quando preço, estoque e crédito batem', () => {
    const out = conferirPedido([{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }, { produtoId: 'p2', quantidade: 20, precoUnit: 31 }], dados());
    expect(out).toEqual({ divergencias: [], totalAtual: 965.6 });
  });

  it('acusa preço diferente com o valor enviado e o atual', () => {
    const out = conferirPedido([{ produtoId: 'p1', quantidade: 4, precoUnit: 84 }], dados());
    expect(out.divergencias).toEqual([{ tipo: 'preco', produtoId: 'p1', nome: 'Margarina', enviado: 84, atual: 86.4 }]);
    expect(out.totalAtual).toBe(345.6);
  });

  it('tolera diferença menor que meio centavo', () => {
    const out = conferirPedido([{ produtoId: 'p1', quantidade: 1, precoUnit: 86.404 }], dados());
    expect(out.divergencias).toEqual([]);
  });

  it('acusa produto sem preço na tabela escolhida', () => {
    const out = conferirPedido([{ produtoId: 'p1', quantidade: 1, precoUnit: 86.4 }], dados({ precos: new Map() }));
    expect(out.divergencias).toEqual([{ tipo: 'sem_preco', produtoId: 'p1', nome: 'Margarina', enviado: 86.4 }]);
    expect(out.totalAtual).toBe(0);
  });

  it('acusa estoque insuficiente com a quantidade pedida e a disponível', () => {
    const out = conferirPedido([{ produtoId: 'p2', quantidade: 20, precoUnit: 31 }], dados({ estoques: new Map([['p2', 5]]) }));
    expect(out.divergencias).toEqual([{ tipo: 'estoque', produtoId: 'p2', nome: 'Açúcar', enviado: 20, atual: 5 }]);
  });

  it('acusa crédito insuficiente pelo total atual', () => {
    const out = conferirPedido([{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }], dados({ creditoDisponivel: 300 }));
    expect(out.divergencias).toEqual([{ tipo: 'credito', enviado: 345.6, atual: 300 }]);
  });

  it('não confere crédito em pagamento à vista nem quando o ERP não informou limite', () => {
    const item = [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }];
    expect(conferirPedido(item, dados({ creditoDisponivel: 0, exigeCredito: false })).divergencias).toEqual([]);
    expect(conferirPedido(item, dados({ creditoDisponivel: null })).divergencias).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/conferir-pedido.spec`
Expected: FAIL com `Cannot find module './conferir-pedido'`.

- [ ] **Step 3: Escrever a regra**

```ts
// apps/api/src/vendas/conferir-pedido.ts
export interface ItemRecebido {
  produtoId: string;
  quantidade: number;
  precoUnit: number;
}

export interface DadosAtuais {
  precos: Map<string, number>;
  estoques: Map<string, number>;
  nomes: Map<string, string>;
  creditoDisponivel: number | null;
  exigeCredito: boolean;
}

export interface Divergencia {
  tipo: 'preco' | 'sem_preco' | 'estoque' | 'credito';
  produtoId?: string;
  nome?: string;
  enviado?: number;
  atual?: number;
}

export function arredondar(valor: number): number {
  // toPrecision(15) desfaz o erro binário de valor*100 (10.075*100 = 1007.4999999999999) antes de arredondar.
  return Math.round(Number((valor * 100).toPrecision(15))) / 100;
}

/**
 * Compara o pedido que saiu do celular com o que o ERP diz AGORA. Não calcula
 * preço: só confere o valor enviado contra `precos` da tabela escolhida.
 */
export function conferirPedido(itens: ItemRecebido[], dados: DadosAtuais): { divergencias: Divergencia[]; totalAtual: number } {
  const divergencias: Divergencia[] = [];
  let totalAtual = 0;
  for (const item of itens) {
    const nome = dados.nomes.get(item.produtoId);
    const atual = dados.precos.get(item.produtoId);
    if (atual === undefined) {
      divergencias.push({ tipo: 'sem_preco', produtoId: item.produtoId, nome, enviado: item.precoUnit });
    } else {
      // Arredonda linha a linha, como o pedido grava em pedido_itens e como o ERP fatura.
      totalAtual += arredondar(atual * item.quantidade);
      if (Math.abs(atual - item.precoUnit) >= 0.005) {
        divergencias.push({ tipo: 'preco', produtoId: item.produtoId, nome, enviado: item.precoUnit, atual });
      }
    }
    const estoque = dados.estoques.get(item.produtoId) ?? 0;
    if (estoque < item.quantidade) {
      divergencias.push({ tipo: 'estoque', produtoId: item.produtoId, nome, enviado: item.quantidade, atual: estoque });
    }
  }
  totalAtual = arredondar(totalAtual);
  if (dados.exigeCredito && dados.creditoDisponivel !== null && totalAtual > dados.creditoDisponivel) {
    divergencias.push({ tipo: 'credito', enviado: totalAtual, atual: dados.creditoDisponivel });
  }
  return { divergencias, totalAtual };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm test -w apps/api -- vendas/conferir-pedido.spec`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/vendas/conferir-pedido.ts apps/api/src/vendas/conferir-pedido.spec.ts
git commit -m "Vendas: regra de divergência do pedido (preço, estoque, crédito)"
```

---

### Task 6: Receber, confirmar, cancelar e listar pedidos

**Files:**
- Create: `apps/api/src/vendas/pedido-vendedor.dto.ts`
- Create: `apps/api/src/vendas/vendas-pedidos.service.ts`
- Modify: `apps/api/src/vendas/vendas.controller.ts`
- Modify: `apps/api/src/vendas/vendas.module.ts`
- Test: `apps/api/src/vendas/vendas-pedidos.spec.ts`

**Interfaces:**
- Consumes: `conferirPedido`, `arredondar`, `Divergencia`, `DadosAtuais` (Task 5); `VendedorGuard` (Task 3); tabelas da Task 1.
- Produces:
  - `interface PedidoResumo { id: string; numero: number; status: string; total: number; divergencias: Divergencia[] }`
  - `function formaInterna(descricao: string): 'boleto' | 'pix' | 'cartao'`
  - `POST /v1/vendas/pedidos` body `PedidoVendedorDto` → `PedidoResumo` (200 também no reenvio).
  - `GET /v1/vendas/pedidos` → `PedidoListado[]` (últimos 60 dias).
  - `POST /v1/vendas/pedidos/:id/confirmar` → `PedidoResumo`; 409 `AINDA_DIVERGENTE` com `divergencias` se restar estoque, crédito ou falta de preço.
  - `POST /v1/vendas/pedidos/:id/cancelar` → `{ ok: true }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/vendas/vendas-pedidos.spec.ts
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { formaInterna, VendasPedidosService } from './vendas-pedidos.service';

const dto = {
  idDispositivo: '11111111-1111-4111-8111-111111111111',
  clienteId: 'c1',
  tabelaPrecoId: 't1',
  condicaoPagamentoId: 'cond1',
  tipoEntrega: 'retirada' as const,
  criadoNoAparelhoEm: '2026-11-09T14:00:00Z',
  itens: [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }],
};

interface Cenario {
  existente?: boolean;
  naCarteira?: boolean;
  precoAtual?: number;
  estoque?: number;
  retido?: { precoItem: number };
}

function montar(c: Cenario = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('where p.id_dispositivo = $1')) {
      return { rows: c.existente ? [{ id: 'ped-antigo', numero: '7', status: 'RECEBIDO', total: '345.60', retencao_json: null }] : [] };
    }
    if (sql.includes('from cliente_vendedor where cliente_id')) return { rowCount: c.naCarteira === false ? 0 : 1, rows: [] };
    if (sql.includes('from condicoes_pagamento_erp cp')) {
      return { rows: [{ condicao: 'BOLETO 14 DIAS', forma: 'BOLETO', tabela_existe: true, tabela_tem_vinculo: false, permitida: false }] };
    }
    if (sql.includes('/* dados_atuais */')) {
      return { rows: [{ id: 'p1', nome: 'Margarina', preco: String(c.precoAtual ?? 86.4), estoque: String(c.estoque ?? 100) }] };
    }
    if (sql.includes('select limite_credito from clientes')) return { rows: [{ limite_credito: '20000.00' }] };
    if (sql.includes('from titulos_cliente')) return { rows: [{ total: '0' }] };
    if (sql.includes('insert into pedidos')) return { rows: [{ id: 'ped-novo', numero: '8' }] };
    if (sql.includes('/* pedido_retido */')) {
      return { rows: c.retido ? [{ id: 'ped-retido', numero: '9', cliente_id: 'c1', tabela_preco_id: 't1', forma_pagamento: 'boleto' }] : [] };
    }
    if (sql.includes('/* itens_retidos */')) {
      return { rows: [{ produto_id: 'p1', quantidade: '4.000', preco_unit: String(c.retido?.precoItem ?? 84) }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
  const chamou = (trecho: string) => query.mock.calls.some(([sql]) => String(sql).includes(trecho));
  const params = (trecho: string) => query.mock.calls.find(([sql]) => String(sql).includes(trecho))?.[1] as unknown[];
  return { servico: new VendasPedidosService(), query, rodar, chamou, params };
}

describe('formaInterna', () => {
  it('trata à vista como pix, cartão de crédito como cartao e o resto como boleto', () => {
    expect(formaInterna('PIX')).toBe('pix');
    expect(formaInterna('Dinheiro')).toBe('pix');
    expect(formaInterna('Cartão de Débito')).toBe('pix');
    expect(formaInterna('Crédito')).toBe('cartao');
    expect(formaInterna('BOLETO')).toBe('boleto');
    expect(formaInterna('Cheque')).toBe('boleto');
  });
});

describe('VendasPedidosService.receber', () => {
  it('reenvio do mesmo idDispositivo devolve o pedido existente e não grava outro', async () => {
    const { servico, rodar, chamou } = montar({ existente: true });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-antigo', numero: 7, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('recusa cliente fora da carteira do vendedor', async () => {
    const { servico, rodar, chamou } = montar({ naCarteira: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toBeInstanceOf(ForbiddenException);
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('sem divergência entra como RECEBIDO, marcado como do vendedor, e vai para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar();
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-novo', numero: 8, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    const p = params('insert into pedidos');
    expect(p).toEqual(expect.arrayContaining(['c1', 'boleto', 'retirada', 345.6, 'BOLETO 14 DIAS', 'RECEBIDO', 'v1', 't1', 'cond1', dto.idDispositivo]));
    expect(chamou('insert into sync_outbox')).toBe(true);
  });

  it('preço diferente retém o pedido com o motivo e NÃO manda para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar({ precoAtual: 90 });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('AGUARDANDO_VENDEDOR');
    expect(out.divergencias).toEqual([{ tipo: 'preco', produtoId: 'p1', nome: 'Margarina', enviado: 86.4, atual: 90 }]);
    expect(out.total).toBe(345.6);
    expect(params('insert into pedidos')).toEqual(expect.arrayContaining(['AGUARDANDO_VENDEDOR']));
    expect(chamou('insert into sync_outbox')).toBe(false);
  });
});

describe('VendasPedidosService.confirmar', () => {
  it('aceita o preço atual, libera o pedido e manda para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4 });
    const out = await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(out).toEqual({ id: 'ped-retido', numero: 9, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    expect(params('update pedido_itens set preco_unit')).toEqual(['ped-retido', 'p1', 86.4, 345.6]);
    expect(chamou('criado_em = now()')).toBe(true);
    expect(chamou('insert into sync_outbox')).toBe(true);
  });

  it('continua retido se ainda falta estoque', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 86.4 }, estoque: 1 });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toBeInstanceOf(ConflictException);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/vendas-pedidos.spec`
Expected: FAIL com `Cannot find module './vendas-pedidos.service'`.

- [ ] **Step 3: Escrever o DTO**

```ts
// apps/api/src/vendas/pedido-vendedor.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  MaxLength, Min, ValidateNested,
} from 'class-validator';

export class ItemPedidoVendedorDto {
  @IsUUID() produtoId!: string;
  @IsNumber() @IsPositive() quantidade!: number;
  @IsNumber() @Min(0) precoUnit!: number;
}

export class PedidoVendedorDto {
  /** Gerado no aparelho; reenvio com o mesmo valor devolve o mesmo pedido. */
  @IsUUID() idDispositivo!: string;
  @IsUUID() clienteId!: string;
  @IsUUID() tabelaPrecoId!: string;
  @IsUUID() condicaoPagamentoId!: string;
  @IsIn(['entrega', 'retirada']) tipoEntrega!: 'entrega' | 'retirada';
  @IsOptional() @IsString() @MaxLength(500) observacoes?: string;
  @IsOptional() @IsUUID() orcamentoId?: string;
  @IsDateString() criadoNoAparelhoEm!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoVendedorDto)
  itens!: ItemPedidoVendedorDto[];
}
```

- [ ] **Step 4: Escrever o serviço**

```ts
// apps/api/src/vendas/vendas-pedidos.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar, conferirPedido, DadosAtuais, Divergencia } from './conferir-pedido';
import { PedidoVendedorDto } from './pedido-vendedor.dto';

interface Consulta {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface PedidoResumo {
  id: string;
  numero: number;
  status: string;
  total: number;
  divergencias: Divergencia[];
}

export interface PedidoListado {
  id: string;
  numero: number;
  idDispositivo: string | null;
  clienteId: string;
  status: string;
  total: number;
  criadoEm: string;
  divergencias: Divergencia[];
}

/**
 * pedidos.forma_pagamento só aceita boleto/pix/cartao. A forma do ERP entra num
 * desses três: à vista = 'pix' (não consome crédito), cartão de crédito = 'cartao',
 * todo o resto a prazo = 'boleto' (confere limite de crédito).
 */
export function formaInterna(descricao: string): 'boleto' | 'pix' | 'cartao' {
  const d = descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/PIX|DINHEIRO|VISTA|DEBITO/.test(d)) return 'pix';
  if (/CART|CREDITO/.test(d)) return 'cartao';
  return 'boleto';
}

@Injectable()
export class VendasPedidosService {
  private async porIdDispositivo(q: Consulta, idDispositivo: string): Promise<PedidoResumo | null> {
    const { rows } = await q.query(
      `select p.id, p.numero, p.status, p.total, p.retencao_json from pedidos p where p.id_dispositivo = $1`,
      [idDispositivo],
    );
    const p = rows[0];
    if (!p) return null;
    return {
      id: p.id, numero: Number(p.numero), status: p.status, total: Number(p.total),
      divergencias: p.status === 'AGUARDANDO_VENDEDOR' ? (p.retencao_json?.divergencias ?? []) : [],
    };
  }

  private async dadosAtuais(q: Consulta, clienteId: string, tabelaId: string, produtoIds: string[], exigeCredito: boolean): Promise<DadosAtuais> {
    const { rows } = await q.query(
      `/* dados_atuais */
       select p.id, p.nome, pr.preco, coalesce(e.quantidade,0) as estoque
         from produtos p
         left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $2
         left join estoques e on e.produto_id = p.id
        where p.id = any($1::uuid[]) and p.ativo`,
      [produtoIds, tabelaId],
    );
    if (rows.length !== produtoIds.length) throw new BadRequestException('Produto inexistente ou inativo no pedido');
    const precos = new Map<string, number>();
    const estoques = new Map<string, number>();
    const nomes = new Map<string, string>();
    for (const r of rows) {
      if (r.preco != null) precos.set(r.id, Number(r.preco));
      estoques.set(r.id, Number(r.estoque));
      nomes.set(r.id, r.nome);
    }
    let creditoDisponivel: number | null = null;
    if (exigeCredito) {
      const lim = await q.query(`select limite_credito from clientes where id = $1`, [clienteId]);
      const limite = lim.rows[0]?.limite_credito;
      if (limite != null) {
        const aberto = await q.query(
          `select coalesce(sum(valor),0) as total from titulos_cliente where cliente_id = $1 and status = 'ABERTO'`,
          [clienteId],
        );
        creditoDisponivel = arredondar(Number(limite) - Number(aberto.rows[0].total));
      }
    }
    return { precos, estoques, nomes, creditoDisponivel, exigeCredito };
  }

  async receber(vendedorId: string, dto: PedidoVendedorDto): Promise<PedidoResumo> {
    const { pool } = tenantCtx();
    const existente = await this.porIdDispositivo(pool, dto.idDispositivo);
    if (existente) return existente;

    const carteira = await pool.query(
      `select 1 from cliente_vendedor where cliente_id = $1 and vendedor_id = $2`,
      [dto.clienteId, vendedorId],
    );
    if (!carteira.rowCount) {
      throw new ForbiddenException({ statusCode: 403, message: 'Cliente fora da sua carteira', codigo: 'CLIENTE_FORA_DA_CARTEIRA' });
    }

    const produtoIds = dto.itens.map((i) => i.produtoId);
    if (new Set(produtoIds).size !== produtoIds.length) throw new BadRequestException('Produto repetido no pedido');

    const cond = await pool.query(
      `select cp.descricao as condicao, fp.descricao as forma,
              exists (select 1 from tabelas_preco t where t.id = $2) as tabela_existe,
              exists (select 1 from tabela_preco_condicoes x where x.tabela_preco_id = $2) as tabela_tem_vinculo,
              exists (select 1 from tabela_preco_condicoes x
                       where x.tabela_preco_id = $2 and x.condicao_pagamento_id = cp.id) as permitida
         from condicoes_pagamento_erp cp join formas_pagamento_erp fp on fp.id = cp.forma_pagamento_id
        where cp.id = $1`,
      [dto.condicaoPagamentoId, dto.tabelaPrecoId],
    );
    const c = cond.rows[0];
    if (!c || !c.tabela_existe) throw new BadRequestException('Tabela ou condição de pagamento inexistente');
    // Tabela sem nenhum vínculo cadastrado aceita qualquer condição (o vínculo ainda não chegou do ERP).
    if (c.tabela_tem_vinculo && !c.permitida) {
      throw new BadRequestException({ statusCode: 400, message: 'Condição de pagamento não permitida para esta tabela', codigo: 'CONDICAO_NAO_PERMITIDA' });
    }
    const forma = formaInterna(c.forma);

    let enderecoJson: string | null = null;
    if (dto.tipoEntrega === 'entrega') {
      const end = await pool.query(
        `select * from cliente_enderecos where cliente_id = $1 order by padrao desc limit 1`,
        [dto.clienteId],
      );
      if (!end.rows[0]) throw new BadRequestException('Cliente sem endereço cadastrado para entrega');
      enderecoJson = JSON.stringify(end.rows[0]);
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [dto.clienteId]);
      const dados = await this.dadosAtuais(client, dto.clienteId, dto.tabelaPrecoId, produtoIds, forma === 'boleto');
      const { divergencias, totalAtual } = conferirPedido(dto.itens, dados);
      const retido = divergencias.length > 0;
      const totalEnviado = arredondar(dto.itens.reduce((t, i) => t + arredondar(i.precoUnit * i.quantidade), 0));
      const total = retido ? totalEnviado : totalAtual;
      const status = retido ? 'AGUARDANDO_VENDEDOR' : 'RECEBIDO';
      const ped = await client.query(
        `insert into pedidos (cliente_id, endereco_snapshot_json, forma_pagamento, tipo_entrega, subtotal, total, observacoes,
                              condicao_pagamento, status, vendedor_id, origem, tabela_preco_id, condicao_pagamento_id,
                              id_dispositivo, retencao_json, criado_no_aparelho_em)
         values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,'vendedor',$10,$11,$12,$13,$14) returning id, numero`,
        [
          dto.clienteId, enderecoJson, forma, dto.tipoEntrega, total, dto.observacoes ?? null, c.condicao, status,
          vendedorId, dto.tabelaPrecoId, dto.condicaoPagamentoId, dto.idDispositivo,
          retido ? JSON.stringify({ divergencias, retidoEm: new Date().toISOString() }) : null,
          dto.criadoNoAparelhoEm,
        ],
      );
      const pedidoId = ped.rows[0].id;
      for (const i of dto.itens) {
        // Retido guarda o preço que o vendedor viu; liberado guarda o preço atual (iguais quando não há divergência).
        const preco = retido ? i.precoUnit : (dados.precos.get(i.produtoId) as number);
        await client.query(
          `insert into pedido_itens (pedido_id, produto_id, descricao_snapshot, quantidade, preco_unit, total)
           values ($1,$2,$3,$4,$5,$6)`,
          [pedidoId, i.produtoId, dados.nomes.get(i.produtoId), i.quantidade, preco, arredondar(preco * i.quantidade)],
        );
      }
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'app')`,
        [pedidoId, status, retido ? 'Pedido do vendedor retido: aguardando confirmação' : 'Pedido recebido do vendedor'],
      );
      if (!retido) {
        await client.query(
          `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
          [pedidoId],
        );
      }
      if (dto.orcamentoId) {
        await client.query(
          `update orcamentos set status = 'convertido', pedido_id = $1, atualizado_em = now()
            where id = $2 and vendedor_id = $3 and status = 'aberto'`,
          [pedidoId, dto.orcamentoId, vendedorId],
        );
      }
      await client.query('commit');
      return { id: pedidoId, numero: Number(ped.rows[0].numero), status, total, divergencias };
    } catch (e) {
      await client.query('rollback');
      // Dois envios simultâneos do mesmo pedido: o segundo bate no índice único e devolve o primeiro.
      if ((e as { code?: string }).code === '23505') {
        const ja = await this.porIdDispositivo(pool, dto.idDispositivo);
        if (ja) return ja;
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /** Vendedor aceita os preços atuais. Estoque, crédito e falta de preço continuam barrando. */
  async confirmar(vendedorId: string, pedidoId: string): Promise<PedidoResumo> {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const ped = await client.query(
        `/* pedido_retido */
         select id, numero, cliente_id, tabela_preco_id, forma_pagamento
           from pedidos where id = $1 and vendedor_id = $2 and status = 'AGUARDANDO_VENDEDOR' for update`,
        [pedidoId, vendedorId],
      );
      const p = ped.rows[0];
      if (!p) throw new NotFoundException('Pedido não encontrado ou já resolvido');
      const itens = await client.query(
        `/* itens_retidos */ select produto_id, quantidade, preco_unit from pedido_itens where pedido_id = $1`,
        [pedidoId],
      );
      const produtoIds = itens.rows.map((i) => i.produto_id);
      const dados = await this.dadosAtuais(client, p.cliente_id, p.tabela_preco_id, produtoIds, p.forma_pagamento === 'boleto');
      const aceitos = itens.rows.map((i) => ({
        produtoId: i.produto_id as string,
        quantidade: Number(i.quantidade),
        precoUnit: dados.precos.get(i.produto_id) ?? Number(i.preco_unit),
      }));
      const { divergencias, totalAtual } = conferirPedido(aceitos, dados);
      if (divergencias.length) {
        throw new ConflictException({
          statusCode: 409, message: 'O pedido ainda tem pendência de estoque ou crédito', codigo: 'AINDA_DIVERGENTE', divergencias,
        });
      }
      for (const i of aceitos) {
        await client.query(
          `update pedido_itens set preco_unit = $3, total = $4 where pedido_id = $1 and produto_id = $2`,
          [pedidoId, i.produtoId, i.precoUnit, arredondar(i.precoUnit * i.quantidade)],
        );
      }
      // criado_em = now(): o ERP busca pedidos por data de criação; sem isso perderia um pedido retido ontem.
      await client.query(
        `update pedidos set status = 'RECEBIDO', subtotal = $2, total = $2, criado_em = now(),
                retencao_json = coalesce(retencao_json, '{}'::jsonb) || jsonb_build_object('confirmadoEm', now())
          where id = $1`,
        [pedidoId, totalAtual],
      );
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'RECEBIDO','Vendedor confirmou os valores atuais','app')`,
        [pedidoId],
      );
      await client.query(
        `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
        [pedidoId],
      );
      await client.query('commit');
      return { id: pedidoId, numero: Number(p.numero), status: 'RECEBIDO', total: totalAtual, divergencias: [] };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async cancelar(vendedorId: string, pedidoId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `update pedidos set status = 'CANCELADO' where id = $1 and vendedor_id = $2 and status = 'AGUARDANDO_VENDEDOR'`,
      [pedidoId, vendedorId],
    );
    if (!rowCount) throw new NotFoundException('Pedido não encontrado ou já resolvido');
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO','Vendedor cancelou o pedido retido','app')`,
      [pedidoId],
    );
    return { ok: true };
  }

  async listar(vendedorId: string): Promise<PedidoListado[]> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, numero, id_dispositivo, cliente_id, status, total, criado_em, retencao_json
         from pedidos
        where vendedor_id = $1 and criado_em > now() - interval '60 days'
        order by criado_em desc`,
      [vendedorId],
    );
    return rows.map((r) => ({
      id: r.id, numero: Number(r.numero), idDispositivo: r.id_dispositivo, clienteId: r.cliente_id, status: r.status,
      total: Number(r.total), criadoEm: r.criado_em,
      divergencias: r.status === 'AGUARDANDO_VENDEDOR' ? (r.retencao_json?.divergencias ?? []) : [],
    }));
  }
}
```

- [ ] **Step 5: Acrescentar as rotas e registrar o serviço**

`apps/api/src/vendas/vendas.controller.ts` passa a ser:

```ts
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PedidoVendedorDto } from './pedido-vendedor.dto';
import { VendasPedidosService } from './vendas-pedidos.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendedorGuard, VendedorLogado } from './vendedor.guard';

type ReqVendedor = Request & { vendedor: VendedorLogado };

@Controller('vendas')
@UseGuards(VendedorGuard)
export class VendasController {
  constructor(
    private readonly sync: VendasSyncService,
    private readonly pedidos: VendasPedidosService,
  ) {}

  @Get('sync')
  carga(@Req() req: ReqVendedor, @Headers('x-app-versao') appVersao?: string) {
    return this.sync.carga(req.vendedor.vendedorId, appVersao);
  }

  @Post('pedidos')
  @HttpCode(200)
  receber(@Req() req: ReqVendedor, @Body() dto: PedidoVendedorDto) {
    return this.pedidos.receber(req.vendedor.vendedorId, dto);
  }

  @Get('pedidos')
  listar(@Req() req: ReqVendedor) {
    return this.pedidos.listar(req.vendedor.vendedorId);
  }

  @Post('pedidos/:id/confirmar')
  @HttpCode(200)
  confirmar(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.confirmar(req.vendedor.vendedorId, id);
  }

  @Post('pedidos/:id/cancelar')
  @HttpCode(200)
  cancelar(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string) {
    return this.pedidos.cancelar(req.vendedor.vendedorId, id);
  }
}
```

Em `apps/api/src/vendas/vendas.module.ts`, importar `VendasPedidosService` e acrescentá-lo em `providers`:

```ts
import { VendasPedidosService } from './vendas-pedidos.service';
```

```ts
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService],
```

- [ ] **Step 6: Rodar os testes e compilar**

Run: `npm test -w apps/api -- vendas/ && npm run build -w apps/api`
Expected: PASS em todos os arquivos de `vendas/` (`vendas-pedidos.spec` com 7 testes); build sem erro.

- [ ] **Step 7: Conferir que o corpo do pedido é validado**

Run: `grep -n "ValidationPipe" apps/api/src/main.ts`
Expected: `app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));` (conferido em 09/11/2026). Com `transform` ligado, os itens do pedido viram `ItemPedidoVendedorDto` e são validados. Se a linha tiver mudado, anote no relatório da tarefa em vez de alterar a configuração global, que afeta todas as rotas existentes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/vendas
git commit -m "Vendas: receber pedido do vendedor com retenção por divergência, confirmar, cancelar e listar"
```

---

### Task 7: ERP não enxerga pedido retido e recebe vendedor, tabela e condição

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts` (interface `PedidoDlinks` e método `listar`)
- Test: `apps/api/src/integracoes-dlinks/dlinks-pedidos.listar.spec.ts`

**Interfaces:**
- Produces: cada pedido da consulta do ERP ganha os campos opcionais `vendedor`, `tabelaPreco`, `condicaoPagamentoCodigo` e `formaPagamentoCodigo`. Pedidos do app do cliente continuam sem eles.

- [ ] **Step 1: Acrescentar o teste que falha**

Dentro do `describe('DlinksPedidosService.listar', ...)` existente em `apps/api/src/integracoes-dlinks/dlinks-pedidos.listar.spec.ts`, acrescentar:

```ts
  it('não lista pedido retido do vendedor e expõe vendedor, tabela e condição', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p2', numero: 10, criado_em: new Date(), tipo_entrega: 'retirada', forma_pagamento: 'boleto', condicao_pagamento: 'BOLETO 14 DIAS',
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'CNPJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [], pagamento_online: null,
        vendedor_codigo: '6', vendedor_nome: 'Ana', tabela_codigo: '14', tabela_nome: 'Retirada boleto 14',
        condicao_codigo: '17', forma_codigo: '15',
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-11-09', '2026-11-09'));
    expect(query.mock.calls[0][0]).toContain("p.status <> 'AGUARDANDO_VENDEDOR'");
    expect(out.pedidos[0]).toEqual(expect.objectContaining({
      vendedor: { codigo: '6', nome: 'Ana' },
      tabelaPreco: { codigo: '14', nome: 'Retirada boleto 14' },
      condicaoPagamentoCodigo: '17',
      formaPagamentoCodigo: '15',
    }));
  });

  it('pedido do app do cliente sai sem os campos do vendedor', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p3', numero: 11, criado_em: new Date(), tipo_entrega: 'entrega', forma_pagamento: 'pix', condicao_pagamento: null,
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'CNPJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [], pagamento_online: null,
        vendedor_codigo: null, vendedor_nome: null, tabela_codigo: null, tabela_nome: null, condicao_codigo: null, forma_codigo: null,
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-11-09', '2026-11-09'));
    expect(out.pedidos[0].vendedor).toBeUndefined();
    expect(out.pedidos[0].tabelaPreco).toBeUndefined();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- dlinks-pedidos.listar.spec`
Expected: FAIL nos 2 testes novos (a consulta ainda não tem `AGUARDANDO_VENDEDOR` e o retorno não tem `vendedor`); o teste antigo continua passando.

- [ ] **Step 3: Alterar a interface**

Em `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`, na interface `PedidoDlinks`, logo depois do campo `pagamentoOnline`, acrescentar:

```ts
  /** Presentes só em pedido tirado pelo vendedor no Fluxo Vendas. */
  vendedor?: { codigo: string; nome: string };
  tabelaPreco?: { codigo: string; nome: string };
  condicaoPagamentoCodigo?: string;
  formaPagamentoCodigo?: string;
```

- [ ] **Step 4: Alterar a consulta e o mapeamento de `listar`**

Na consulta de `listar`, trocar o trecho:

```ts
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em >= ($1::date)::timestamp at time zone 'America/Recife'
          and p.criado_em < ($2::date + 1)::timestamp at time zone 'America/Recife'
          and p.status <> 'AGUARDANDO_PAGAMENTO'
        order by p.criado_em`,
```

por:

```ts
         from pedidos p join clientes c on c.id = p.cliente_id
         left join vendedores v on v.id = p.vendedor_id
         left join tabelas_preco tp on tp.id = p.tabela_preco_id
         left join condicoes_pagamento_erp cpe on cpe.id = p.condicao_pagamento_id
         left join formas_pagamento_erp fpe on fpe.id = cpe.forma_pagamento_id
        where p.criado_em >= ($1::date)::timestamp at time zone 'America/Recife'
          and p.criado_em < ($2::date + 1)::timestamp at time zone 'America/Recife'
          and p.status <> 'AGUARDANDO_PAGAMENTO'
          and p.status <> 'AGUARDANDO_VENDEDOR'
        order by p.criado_em`,
```

No `select` da mesma consulta, logo depois de `p.endereco_snapshot_json, p.valor_saldo_usado,`, acrescentar a linha:

```ts
              v.erp_vendedor_id as vendedor_codigo, v.nome as vendedor_nome,
              tp.erp_tabela_id as tabela_codigo, tp.nome as tabela_nome,
              cpe.erp_condicao_id as condicao_codigo, fpe.erp_forma_pagamento_id as forma_codigo,
```

No mapeamento do retorno, logo depois de `pagamentoOnline: r.pagamento_online ?? undefined,`, acrescentar:

```ts
        vendedor: r.vendedor_codigo ? { codigo: r.vendedor_codigo, nome: r.vendedor_nome } : undefined,
        tabelaPreco: r.tabela_codigo ? { codigo: r.tabela_codigo, nome: r.tabela_nome } : undefined,
        condicaoPagamentoCodigo: r.condicao_codigo ?? undefined,
        formaPagamentoCodigo: r.forma_codigo ?? undefined,
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test -w apps/api -- integracoes-dlinks/`
Expected: PASS em todos os arquivos da pasta, incluindo os 3 testes de `dlinks-pedidos.listar.spec`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts apps/api/src/integracoes-dlinks/dlinks-pedidos.listar.spec.ts
git commit -m "Vendas: consulta de pedidos do ERP ignora pedido retido e informa vendedor, tabela e condição"
```

---

### Task 8: Orçamentos

**Files:**
- Create: `apps/api/src/vendas/orcamento.dto.ts`
- Create: `apps/api/src/vendas/vendas-orcamentos.service.ts`
- Modify: `apps/api/src/vendas/vendas.controller.ts`
- Modify: `apps/api/src/vendas/vendas.module.ts`
- Test: `apps/api/src/vendas/vendas-orcamentos.spec.ts`

**Interfaces:**
- Consumes: `ItemPedidoVendedorDto` (Task 6), `arredondar` (Task 5).
- Produces:
  - `PUT /v1/vendas/orcamentos/:id` body `OrcamentoDto` → `{ id, status: 'aberto', total }`. O `:id` é gerado no aparelho; repetir a chamada atualiza o mesmo orçamento.
  - `GET /v1/vendas/orcamentos` → `OrcamentoListado[]` (abertos e os dos últimos 60 dias).
  - `POST /v1/vendas/orcamentos/:id/cancelar` → `{ ok: true }`.
  - A conversão em pedido é feita pela Task 6, quando o pedido chega com `orcamentoId`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/vendas/vendas-orcamentos.spec.ts
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { VendasOrcamentosService } from './vendas-orcamentos.service';

const dto = {
  clienteId: 'c1', tabelaPrecoId: 't1', tipoEntrega: 'retirada' as const,
  itens: [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }, { produtoId: 'p2', quantidade: 20, precoUnit: 31 }],
};

function montar(opcoes: { naCarteira?: boolean; gravou?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from cliente_vendedor where cliente_id')) return { rowCount: opcoes.naCarteira === false ? 0 : 1, rows: [] };
    if (sql.includes('insert into orcamentos')) return { rowCount: opcoes.gravou === false ? 0 : 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
  return { servico: new VendasOrcamentosService(), query, rodar };
}

describe('VendasOrcamentosService.salvar', () => {
  it('grava o orçamento com o total calculado e troca os itens', async () => {
    const { servico, query, rodar } = montar();
    const out = await rodar(() => servico.salvar('v1', 'orc-1', dto as never));
    expect(out).toEqual({ id: 'orc-1', status: 'aberto', total: 965.6 });
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into orcamentos'));
    expect(String(insert![0])).toContain("where orcamentos.vendedor_id = excluded.vendedor_id and orcamentos.status = 'aberto'");
    expect(query.mock.calls.some(([sql]) => String(sql).includes('delete from orcamento_itens'))).toBe(true);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('insert into orcamento_itens'))).toHaveLength(2);
  });

  it('recusa cliente fora da carteira', async () => {
    const { servico, rodar } = montar({ naCarteira: false });
    await expect(rodar(() => servico.salvar('v1', 'orc-1', dto as never))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa alterar orçamento já convertido, cancelado ou de outro vendedor', async () => {
    const { servico, rodar } = montar({ gravou: false });
    await expect(rodar(() => servico.salvar('v1', 'orc-1', dto as never))).rejects.toBeInstanceOf(ConflictException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/vendas-orcamentos.spec`
Expected: FAIL com `Cannot find module './vendas-orcamentos.service'`.

- [ ] **Step 3: Escrever o DTO**

```ts
// apps/api/src/vendas/orcamento.dto.ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ItemPedidoVendedorDto } from './pedido-vendedor.dto';

export class OrcamentoDto {
  @IsUUID() clienteId!: string;
  @IsUUID() tabelaPrecoId!: string;
  @IsOptional() @IsUUID() condicaoPagamentoId?: string;
  @IsIn(['entrega', 'retirada']) tipoEntrega!: 'entrega' | 'retirada';
  @IsOptional() @IsString() @MaxLength(500) observacoes?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoVendedorDto)
  itens!: ItemPedidoVendedorDto[];
}
```

- [ ] **Step 4: Escrever o serviço**

```ts
// apps/api/src/vendas/vendas-orcamentos.service.ts
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar } from './conferir-pedido';
import { OrcamentoDto } from './orcamento.dto';

export interface OrcamentoListado {
  id: string;
  clienteId: string;
  tabelaPrecoId: string;
  condicaoPagamentoId: string | null;
  tipoEntrega: string;
  observacoes: string | null;
  total: number;
  status: string;
  pedidoId: string | null;
  criadoEm: string;
  atualizadoEm: string;
  itens: Array<{ produtoId: string; quantidade: number; precoUnit: number }>;
}

/** Orçamento vive fora de `pedidos`: o ERP nunca o vê. Vira pedido quando o app envia o pedido com `orcamentoId`. */
@Injectable()
export class VendasOrcamentosService {
  async salvar(vendedorId: string, id: string, dto: OrcamentoDto) {
    const { pool } = tenantCtx();
    const carteira = await pool.query(
      `select 1 from cliente_vendedor where cliente_id = $1 and vendedor_id = $2`,
      [dto.clienteId, vendedorId],
    );
    if (!carteira.rowCount) {
      throw new ForbiddenException({ statusCode: 403, message: 'Cliente fora da sua carteira', codigo: 'CLIENTE_FORA_DA_CARTEIRA' });
    }
    const produtoIds = dto.itens.map((i) => i.produtoId);
    if (new Set(produtoIds).size !== produtoIds.length) throw new BadRequestException('Produto repetido no orçamento');
    const total = arredondar(dto.itens.reduce((t, i) => t + arredondar(i.precoUnit * i.quantidade), 0));

    const client = await pool.connect();
    try {
      await client.query('begin');
      const gravado = await client.query(
        `insert into orcamentos (id, vendedor_id, cliente_id, tabela_preco_id, condicao_pagamento_id, tipo_entrega, observacoes, total)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set
           cliente_id = excluded.cliente_id, tabela_preco_id = excluded.tabela_preco_id,
           condicao_pagamento_id = excluded.condicao_pagamento_id, tipo_entrega = excluded.tipo_entrega,
           observacoes = excluded.observacoes, total = excluded.total, atualizado_em = now()
         where orcamentos.vendedor_id = excluded.vendedor_id and orcamentos.status = 'aberto'`,
        [id, vendedorId, dto.clienteId, dto.tabelaPrecoId, dto.condicaoPagamentoId ?? null, dto.tipoEntrega, dto.observacoes ?? null, total],
      );
      if (!gravado.rowCount) {
        throw new ConflictException({ statusCode: 409, message: 'Este orçamento não pode mais ser alterado', codigo: 'ORCAMENTO_FECHADO' });
      }
      await client.query(`delete from orcamento_itens where orcamento_id = $1`, [id]);
      for (const i of dto.itens) {
        await client.query(
          `insert into orcamento_itens (orcamento_id, produto_id, quantidade, preco_unit) values ($1,$2,$3,$4)`,
          [id, i.produtoId, i.quantidade, i.precoUnit],
        );
      }
      await client.query('commit');
      return { id, status: 'aberto' as const, total };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async listar(vendedorId: string): Promise<OrcamentoListado[]> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select o.id, o.cliente_id, o.tabela_preco_id, o.condicao_pagamento_id, o.tipo_entrega, o.observacoes, o.total,
              o.status, o.pedido_id, o.criado_em, o.atualizado_em,
              (select json_agg(json_build_object('produtoId', i.produto_id, 'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from orcamento_itens i where i.orcamento_id = o.id) as itens
         from orcamentos o
        where o.vendedor_id = $1 and (o.status = 'aberto' or o.atualizado_em > now() - interval '60 days')
        order by o.atualizado_em desc`,
      [vendedorId],
    );
    return rows.map((o) => ({
      id: o.id, clienteId: o.cliente_id, tabelaPrecoId: o.tabela_preco_id, condicaoPagamentoId: o.condicao_pagamento_id,
      tipoEntrega: o.tipo_entrega, observacoes: o.observacoes, total: Number(o.total), status: o.status, pedidoId: o.pedido_id,
      criadoEm: o.criado_em, atualizadoEm: o.atualizado_em,
      itens: (o.itens ?? []).map((i: { produtoId: string; quantidade: unknown; precoUnit: unknown }) => ({
        produtoId: i.produtoId, quantidade: Number(i.quantidade), precoUnit: Number(i.precoUnit),
      })),
    }));
  }

  async cancelar(vendedorId: string, id: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `update orcamentos set status = 'cancelado', atualizado_em = now() where id = $1 and vendedor_id = $2 and status = 'aberto'`,
      [id, vendedorId],
    );
    if (!rowCount) throw new NotFoundException('Orçamento não encontrado ou já fechado');
    return { ok: true };
  }
}
```

- [ ] **Step 5: Acrescentar as rotas e registrar o serviço**

Em `apps/api/src/vendas/vendas.controller.ts`:

Trocar a linha de import do `@nestjs/common` por:

```ts
import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
```

Acrescentar os imports:

```ts
import { OrcamentoDto } from './orcamento.dto';
import { VendasOrcamentosService } from './vendas-orcamentos.service';
```

O construtor passa a ser:

```ts
  constructor(
    private readonly sync: VendasSyncService,
    private readonly pedidos: VendasPedidosService,
    private readonly orcamentos: VendasOrcamentosService,
  ) {}
```

E, no fim da classe, acrescentar:

```ts
  @Put('orcamentos/:id')
  salvarOrcamento(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OrcamentoDto) {
    return this.orcamentos.salvar(req.vendedor.vendedorId, id, dto);
  }

  @Get('orcamentos')
  listarOrcamentos(@Req() req: ReqVendedor) {
    return this.orcamentos.listar(req.vendedor.vendedorId);
  }

  @Post('orcamentos/:id/cancelar')
  @HttpCode(200)
  cancelarOrcamento(@Req() req: ReqVendedor, @Param('id', ParseUUIDPipe) id: string) {
    return this.orcamentos.cancelar(req.vendedor.vendedorId, id);
  }
```

Em `apps/api/src/vendas/vendas.module.ts`, importar `VendasOrcamentosService` e acrescentá-lo em `providers`:

```ts
import { VendasOrcamentosService } from './vendas-orcamentos.service';
```

```ts
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService, VendasOrcamentosService],
```

- [ ] **Step 6: Rodar os testes e compilar**

Run: `npm test -w apps/api -- vendas/ && npm run build -w apps/api`
Expected: PASS (`vendas-orcamentos.spec` com 3 testes); build sem erro.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/vendas
git commit -m "Vendas: orçamentos do vendedor (salvar, listar, cancelar), fora da tabela de pedidos"
```

---

### Task 9: Números da tela Início

**Files:**
- Create: `apps/api/src/vendas/vendas-resumo.service.ts`
- Modify: `apps/api/src/vendas/vendas.controller.ts`
- Modify: `apps/api/src/vendas/vendas.module.ts`
- Test: `apps/api/src/vendas/vendas-resumo.spec.ts`

**Interfaces:**
- Produces: `GET /v1/vendas/resumo` → `ResumoVendedor { vendidoHoje, pedidosHoje, ticketMedioHoje, vendidoMes, clientesCarteira, clientesPositivadosMes, pedidosRetidos, orcamentosAbertos }` (todos `number`).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/vendas/vendas-resumo.spec.ts
import { runComTenant } from '../tenancy/tenant-context';
import { VendasResumoService } from './vendas-resumo.service';

describe('VendasResumoService.resumo', () => {
  it('converte os números e calcula o ticket médio', async () => {
    const query = jest.fn(async () => ({ rows: [{
      vendido_hoje: '9840.00', pedidos_hoje: 6, vendido_mes: '46200.00', carteira: 38, positivados: 28, retidos: 1, orcamentos: 2,
    }] }));
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasResumoService().resumo('v1'));
    expect(out).toEqual({
      vendidoHoje: 9840, pedidosHoje: 6, ticketMedioHoje: 1640, vendidoMes: 46200,
      clientesCarteira: 38, clientesPositivadosMes: 28, pedidosRetidos: 1, orcamentosAbertos: 2,
    });
    expect(String(query.mock.calls[0][0])).toContain("'America/Recife'");
    expect(query.mock.calls[0][1]).toEqual(['v1']);
  });

  it('ticket médio é zero em dia sem pedido', async () => {
    const query = jest.fn(async () => ({ rows: [{
      vendido_hoje: '0', pedidos_hoje: 0, vendido_mes: '0', carteira: 38, positivados: 0, retidos: 0, orcamentos: 0,
    }] }));
    const out = await runComTenant({ tenant: {}, pool: { query } } as never, () => new VendasResumoService().resumo('v1'));
    expect(out.ticketMedioHoje).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/vendas-resumo.spec`
Expected: FAIL com `Cannot find module './vendas-resumo.service'`.

- [ ] **Step 3: Escrever o serviço**

```ts
// apps/api/src/vendas/vendas-resumo.service.ts
import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar } from './conferir-pedido';

export interface ResumoVendedor {
  vendidoHoje: number;
  pedidosHoje: number;
  ticketMedioHoje: number;
  vendidoMes: number;
  clientesCarteira: number;
  clientesPositivadosMes: number;
  pedidosRetidos: number;
  orcamentosAbertos: number;
}

/** "Hoje" e "mês" no fuso de Recife. Pedido cancelado, retido ou aguardando pagamento não conta como venda. */
@Injectable()
export class VendasResumoService {
  async resumo(vendedorId: string): Promise<ResumoVendedor> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `with v as (
         select p.cliente_id, p.total,
                (p.criado_em at time zone 'America/Recife')::date as dia
           from pedidos p
          where p.vendedor_id = $1
            and p.status not in ('CANCELADO','AGUARDANDO_VENDEDOR','AGUARDANDO_PAGAMENTO')
            and p.criado_em >= date_trunc('month', now() at time zone 'America/Recife') at time zone 'America/Recife'
       ), hoje as (select (now() at time zone 'America/Recife')::date as d)
       select
         (select coalesce(sum(total),0) from v, hoje where v.dia = hoje.d) as vendido_hoje,
         (select count(*)::int from v, hoje where v.dia = hoje.d) as pedidos_hoje,
         (select coalesce(sum(total),0) from v) as vendido_mes,
         (select count(*)::int from cliente_vendedor where vendedor_id = $1) as carteira,
         (select count(distinct v.cliente_id)::int from v join cliente_vendedor cv on cv.cliente_id = v.cliente_id and cv.vendedor_id = $1) as positivados,
         (select count(*)::int from pedidos where vendedor_id = $1 and status = 'AGUARDANDO_VENDEDOR') as retidos,
         (select count(*)::int from orcamentos where vendedor_id = $1 and status = 'aberto') as orcamentos`,
      [vendedorId],
    );
    const r = rows[0];
    const vendidoHoje = Number(r.vendido_hoje);
    const pedidosHoje = Number(r.pedidos_hoje);
    return {
      vendidoHoje,
      pedidosHoje,
      ticketMedioHoje: pedidosHoje ? arredondar(vendidoHoje / pedidosHoje) : 0,
      vendidoMes: Number(r.vendido_mes),
      clientesCarteira: Number(r.carteira),
      clientesPositivadosMes: Number(r.positivados),
      pedidosRetidos: Number(r.retidos),
      orcamentosAbertos: Number(r.orcamentos),
    };
  }
}
```

- [ ] **Step 4: Acrescentar a rota e registrar o serviço**

Em `apps/api/src/vendas/vendas.controller.ts`, acrescentar o import:

```ts
import { VendasResumoService } from './vendas-resumo.service';
```

O construtor passa a ser:

```ts
  constructor(
    private readonly sync: VendasSyncService,
    private readonly pedidos: VendasPedidosService,
    private readonly orcamentos: VendasOrcamentosService,
    private readonly resumoService: VendasResumoService,
  ) {}
```

E, no fim da classe, acrescentar:

```ts
  @Get('resumo')
  resumo(@Req() req: ReqVendedor) {
    return this.resumoService.resumo(req.vendedor.vendedorId);
  }
```

Em `apps/api/src/vendas/vendas.module.ts`, importar `VendasResumoService` e acrescentá-lo em `providers`:

```ts
import { VendasResumoService } from './vendas-resumo.service';
```

```ts
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService, VendasOrcamentosService, VendasResumoService],
```

- [ ] **Step 5: Rodar os testes e compilar**

Run: `npm test -w apps/api -- vendas/ && npm run build -w apps/api`
Expected: PASS (`vendas-resumo.spec` com 2 testes); build sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/vendas
git commit -m "Vendas: resumo do vendedor para a tela Início"
```

---

### Task 10: Administração de vendedores e do vínculo tabela × condição

**Files:**
- Create: `apps/api/src/vendas/admin-vendas.controller.ts`
- Modify: `apps/api/src/vendas/vendas.module.ts`
- Test: `apps/api/src/vendas/admin-vendas.spec.ts`

**Interfaces:**
- Consumes: `AdminGuard` e `AdminLogado` de `apps/api/src/admin/admin.guard.ts` (o guard só depende do `JwtService`, que é global; ele é declarado de novo como provider neste módulo).
- Produces (todas exigem token da retaguarda):
  - `GET /v1/admin/vendas/vendedores` → `[{ id, erpVendedorId, nome, filial, login, temSenha, ativo, ultimaSyncEm, appVersao, clientes }]`
  - `PUT /v1/admin/vendas/vendedores/:id/acesso` body `{ login, senha?, ativo }` → `{ ok: true }`. Senha com no mínimo 8 caracteres. Desativar ou trocar a senha encerra as sessões do vendedor.
  - `GET /v1/admin/vendas/tabelas-condicoes` → `{ tabelas: [{ id, nome, condicaoIds: string[] }], condicoes: [{ id, descricao, forma }] }`
  - `PUT /v1/admin/vendas/tabelas-condicoes/:tabelaId` body `{ condicaoIds: string[] }` → `{ ok: true }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
// apps/api/src/vendas/admin-vendas.spec.ts
import { ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { runComTenant } from '../tenancy/tenant-context';
import { AdminVendasController } from './admin-vendas.controller';

function montar(opcoes: { loginEmUso?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from vendedores where login = $1 and id <> $2')) return { rowCount: opcoes.loginEmUso ? 1 : 0, rows: [] };
    if (sql.includes('update vendedores set login')) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
  const params = (trecho: string) => query.mock.calls.find(([sql]) => String(sql).includes(trecho))?.[1] as unknown[];
  const chamou = (trecho: string) => query.mock.calls.some(([sql]) => String(sql).includes(trecho));
  return { controller: new AdminVendasController(), rodar, params, chamou };
}

describe('AdminVendasController.definirAcesso', () => {
  it('grava o login em minúsculas, a senha com argon2 e encerra as sessões abertas', async () => {
    const { controller, rodar, params, chamou } = montar();
    await rodar(() => controller.definirAcesso('vend-1', { login: ' Ana.Paula ', senha: 'segredo123', ativo: true } as never));
    const p = params('update vendedores set login');
    expect(p[0]).toBe('vend-1');
    expect(p[1]).toBe('ana.paula');
    expect(await argon2.verify(String(p[2]), 'segredo123')).toBe(true);
    expect(p[3]).toBe(true);
    expect(chamou("delete from refresh_tokens where sujeito_id = $1 and sujeito = 'vendedor'")).toBe(true);
  });

  it('sem senha nova mantém a senha atual e as sessões', async () => {
    const { controller, rodar, params, chamou } = montar();
    await rodar(() => controller.definirAcesso('vend-1', { login: 'ana', ativo: true } as never));
    expect(params('update vendedores set login')[2]).toBeNull();
    expect(chamou('delete from refresh_tokens')).toBe(false);
  });

  it('desativar encerra as sessões mesmo sem trocar a senha', async () => {
    const { controller, rodar, chamou } = montar();
    await rodar(() => controller.definirAcesso('vend-1', { login: 'ana', ativo: false } as never));
    expect(chamou('delete from refresh_tokens')).toBe(true);
  });

  it('recusa login já usado por outro vendedor', async () => {
    const { controller, rodar } = montar({ loginEmUso: true });
    await expect(rodar(() => controller.definirAcesso('vend-1', { login: 'ana', ativo: true } as never))).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AdminVendasController.definirCondicoes', () => {
  it('troca todas as condições da tabela', async () => {
    const { controller, rodar, params, chamou } = montar();
    await rodar(() => controller.definirCondicoes('tab-1', { condicaoIds: ['c1', 'c2'] } as never));
    expect(params('delete from tabela_preco_condicoes')).toEqual(['tab-1']);
    expect(chamou('insert into tabela_preco_condicoes')).toBe(true);
    expect(params('insert into tabela_preco_condicoes')).toEqual(['tab-1', ['c1', 'c2']]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api -- vendas/admin-vendas.spec`
Expected: FAIL com `Cannot find module './admin-vendas.controller'`.

- [ ] **Step 3: Escrever o controller**

```ts
// apps/api/src/vendas/admin-vendas.controller.ts
import { Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ArrayUnique, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MinLength } from 'class-validator';
import { AdminGuard } from '../admin/admin.guard';
import { tenantCtx } from '../tenancy/tenant-context';

class AcessoVendedorDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Login aceita letras, números, ponto, hífen e sublinhado' })
  login!: string;

  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;

  @IsBoolean() ativo!: boolean;
}

class CondicoesDaTabelaDto {
  @IsArray() @ArrayUnique() @IsUUID(undefined, { each: true })
  condicaoIds!: string[];
}

@Controller('admin/vendas')
@UseGuards(AdminGuard)
export class AdminVendasController {
  @Get('vendedores')
  async vendedores() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select v.id, v.erp_vendedor_id, v.nome, v.filial, v.login, (v.senha_hash is not null) as tem_senha, v.ativo,
              v.ultima_sync_em, v.app_versao,
              (select count(*)::int from cliente_vendedor cv where cv.vendedor_id = v.id) as clientes
         from vendedores v order by v.nome`,
    );
    return rows.map((v) => ({
      id: v.id, erpVendedorId: v.erp_vendedor_id, nome: v.nome, filial: v.filial, login: v.login, temSenha: v.tem_senha,
      ativo: v.ativo, ultimaSyncEm: v.ultima_sync_em, appVersao: v.app_versao, clientes: v.clientes,
    }));
  }

  /** Senha ausente mantém a atual. Trocar a senha ou desativar derruba as sessões abertas do vendedor. */
  @Put('vendedores/:id/acesso')
  async definirAcesso(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AcessoVendedorDto) {
    const { pool } = tenantCtx();
    const login = dto.login.trim().toLowerCase();
    const emUso = await pool.query(`select 1 from vendedores where login = $1 and id <> $2`, [login, id]);
    if (emUso.rowCount) throw new ConflictException('Este login já está em uso por outro vendedor');
    const senhaHash = dto.senha ? await argon2.hash(dto.senha) : null;
    const { rowCount } = await pool.query(
      `update vendedores set login = $2, senha_hash = coalesce($3, senha_hash), ativo = $4 where id = $1`,
      [id, login, senhaHash, dto.ativo],
    );
    if (!rowCount) throw new NotFoundException('Vendedor não encontrado');
    if (senhaHash || !dto.ativo) {
      // Apaga em vez de revogar: a renovação aceita token revogado há menos de 30 s.
      await pool.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'vendedor'`, [id]);
    }
    return { ok: true };
  }

  @Get('tabelas-condicoes')
  async tabelasCondicoes() {
    const { pool } = tenantCtx();
    const tabelas = await pool.query(
      `select t.id, t.nome,
              coalesce((select array_agg(x.condicao_pagamento_id) from tabela_preco_condicoes x where x.tabela_preco_id = t.id), '{}') as condicao_ids
         from tabelas_preco t where t.erp_tabela_id is not null order by t.nome`,
    );
    const condicoes = await pool.query(
      `select cp.id, cp.descricao, fp.descricao as forma
         from condicoes_pagamento_erp cp join formas_pagamento_erp fp on fp.id = cp.forma_pagamento_id
        order by fp.descricao, cp.descricao`,
    );
    return {
      tabelas: tabelas.rows.map((t) => ({ id: t.id, nome: t.nome, condicaoIds: t.condicao_ids })),
      condicoes: condicoes.rows.map((c) => ({ id: c.id, descricao: c.descricao, forma: c.forma })),
    };
  }

  @Put('tabelas-condicoes/:tabelaId')
  async definirCondicoes(@Param('tabelaId', ParseUUIDPipe) tabelaId: string, @Body() dto: CondicoesDaTabelaDto) {
    const { pool } = tenantCtx();
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`delete from tabela_preco_condicoes where tabela_preco_id = $1`, [tabelaId]);
      if (dto.condicaoIds.length) {
        await client.query(
          `insert into tabela_preco_condicoes (tabela_preco_id, condicao_pagamento_id)
           select $1, unnest($2::uuid[])`,
          [tabelaId, dto.condicaoIds],
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  }
}
```

Nos testes o controller é chamado direto, sem o `ParseUUIDPipe`, por isso os ids de teste não precisam ser UUID.

- [ ] **Step 4: Registrar no módulo**

`apps/api/src/vendas/vendas.module.ts` passa a ser:

```ts
import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AdminVendasController } from './admin-vendas.controller';
import { VendasAuthController } from './vendas-auth.controller';
import { VendasAuthService } from './vendas-auth.service';
import { VendasOrcamentosService } from './vendas-orcamentos.service';
import { VendasPedidosService } from './vendas-pedidos.service';
import { VendasResumoService } from './vendas-resumo.service';
import { VendasSyncService } from './vendas-sync.service';
import { VendasController } from './vendas.controller';
import { VendedorGuard } from './vendedor.guard';

@Module({
  controllers: [VendasAuthController, VendasController, AdminVendasController],
  providers: [VendasAuthService, VendedorGuard, VendasSyncService, VendasPedidosService, VendasOrcamentosService, VendasResumoService, AdminGuard],
})
export class VendasModule {}
```

- [ ] **Step 5: Rodar toda a suíte da API e compilar**

Run: `npm test -w apps/api && npm run build -w apps/api`
Expected: todos os testes passam (os existentes e os novos de `vendas/` e `integracoes-dlinks/`); build sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/vendas
git commit -m "Vendas: retaguarda define acesso do vendedor e condições aceitas por tabela"
```

---

## Depois deste plano

- **Aplicar em produção**: a migração 034 é manual (`psql` no servidor), antes de subir a API nova. A API antiga continua funcionando com a migração aplicada, porque tudo é aditivo.
- **Documento para o ERP**: acrescentar ao handoff de integração os dois envios novos (`funcionarios`, `clientes-funcionarios`) e os quatro campos novos da consulta de pedidos. Não citar o nome do aplicativo de terceiros.
- **Plano 2**: app Flutter `apps/vendas`, consumindo exatamente os contratos `CargaVendedor`, `PedidoVendedorDto`, `PedidoResumo`, `PedidoListado`, `OrcamentoDto`, `OrcamentoListado` e `ResumoVendedor` definidos aqui.
- **Plano 3**: seção Vendas na retaguarda, consumindo `/v1/admin/vendas/*`, mais o papel de supervisor e as telas de painel, pedidos e orçamentos.
