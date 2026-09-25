# PIX online no checkout (API PIX Itaú) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cobrar o PIX na hora do pedido (QR + copia-e-cola no app), segurar o pedido em `AGUARDANDO_PAGAMENTO` até o Itaú confirmar, e só então deixar o Dlinks enxergar.

**Architecture:** Módulo NestJS `pagamentos` com contrato `ProvedorPagamento` (Itaú PIX agora, e.Rede depois, `mock` em dev), tabela `pagamentos` no tenant e `pagamento_provedores` no banco de controle. Confirmação por webhook (segredo na URL, mesmo padrão MaxiPago) com worker de consulta a cada 30 s como rede de segurança. App Flutter desenha o QR a partir do copia-e-cola; retaguarda ganha status e card de pagamento.

**Tech Stack:** NestJS 10 + pg (API), React (retaguarda), Flutter (app, pacote `qr_flutter`), PostgreSQL, Jest. Itaú: OAuth client_credentials com mTLS (.pfx) em `sts.itau.com.br`, API PIX Recebimentos v2.

Spec: `docs/superpowers/specs/2026-09-25-pix-online-itau-design.md`.

## Global Constraints

- Segredos (client secret, senha do pfx, segredo do webhook em texto puro) NUNCA entram no repositório nem em log. Vivem em `C:\itau-cahu-pix\credencial.json` no `.254` e só o hash sha256 do segredo do webhook vai pro banco.
- Nada muda no Dlinks: nenhuma tabela/tela deles, e o contrato dos endpoints `integracoes/dlinks/*` só ganha campos opcionais.
- Migrações são arquivos SQL aplicados por `psql` (não há runner em código). Tenant: `infra/sql/tenant/030_pagamentos.sql`. Controle: `infra/sql/control/004_pagamento_provedores.sql`. Cada arquivo termina com `insert into schema_migrations (versao) values ('NNN') on conflict do nothing;`.
- Expiração do PIX: 1800 s. Chave PIX: CNPJ `61920643000148`. Certificado em `C:\itau-cahu-pix\certificado.pfx`, senha `<senha do pfx — fora do repo>`.
- Testes: `npm test -- <arquivo>` dentro de `apps/api`. Estilo dos specs existentes: instanciar o service direto, `runComTenant({ tenant, pool }, ...)` com `pool.query` = `jest.fn()`.
- Commits pequenos, mensagens em português, sem prefixo `feat:` (o repo usa frases: "Adiciona ...", "Corrige ...").
- App sempre aponta pra `https://cahudelivery.duckdns.org`. Flutter em `C:\dev\flutter\bin\flutter`.

---

### Task 0: Sincronizar a main local com origin/main

A main local está 2 commits à frente e 22 atrás de `origin/main`, com dois arquivos modificados sem commit. Sem isso, o código do PIX nasce em cima de uma base velha.

**Files:** nenhum novo.

- [ ] **Step 1: Guardar as alterações locais soltas**

```bash
cd "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce"
git stash push -m "wip antes do pix" -- apps/admin/src/paginas/PedidoDetalhe.tsx apps/mobile/android/app/src/main/res/drawable-hdpi/android12splash.png
```

- [ ] **Step 2: Rebase dos 2 commits locais em cima da origin**

```bash
git fetch origin
git rebase origin/main
```
Expected: `Successfully rebased and updated refs/heads/main.` Se der conflito, é só em arquivos de docs (spec) ou em `municipios`; resolver mantendo os dois lados e `git rebase --continue`.

- [ ] **Step 3: Reaplicar o stash e decidir**

```bash
git stash pop
git diff --stat
```
Se o diff de `PedidoDetalhe.tsx` for trabalho inacabado, deixar como está (a Task 9 edita esse arquivo e absorve). O `android12splash.png` é regenerado pelo `flutter_native_splash`; pode `git checkout -- apps/mobile/android/app/src/main/res/drawable-hdpi/android12splash.png`.

- [ ] **Step 4: Confirmar que os testes existentes passam na base nova**

```bash
cd apps/api && npm test 2>&1 | tail -5
```
Expected: `Tests: ... passed`. Se `node_modules` estiver desatualizado (erro de módulo), `npm install` na raiz do monorepo antes.

- [ ] **Step 5: Push da main sincronizada**

```bash
git push origin main
```

---

### Task 1: Migrações e tipos compartilhados

**Files:**
- Create: `infra/sql/tenant/030_pagamentos.sql`
- Create: `infra/sql/control/004_pagamento_provedores.sql`
- Modify: `packages/shared-types/src/index.ts:6-17`

**Interfaces:**
- Produces: tabela `pagamentos`, tabela `pagamento_provedores`, status `AGUARDANDO_PAGAMENTO` aceito em `pedidos.status`, `pagamento_webhooks.origem` livre.

- [ ] **Step 1: Migração do tenant**

```sql
-- infra/sql/tenant/030_pagamentos.sql
-- Pagamento online no checkout (PIX Itaú agora, cartão e.Rede depois).
-- Um pedido pago online nasce em AGUARDANDO_PAGAMENTO e só vira RECEBIDO
-- (visível pro Dlinks) quando o provedor confirma.

alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('AGUARDANDO_PAGAMENTO','RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO','FATURADO',
                    'EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO'));

create table if not exists pagamentos (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id),
  provedor      text not null,                       -- itau_pix | rede_cartao | mock
  metodo        text not null check (metodo in ('pix','cartao')),
  status        text not null default 'pendente'
                check (status in ('pendente','pago','expirado','cancelado','falhou')),
  valor         numeric(12,2) not null,
  valor_pago    numeric(12,2),
  provedor_ref  text,                                -- txid do Itaú
  copia_cola    text,                                -- BR Code (PIX copia e cola)
  expira_em     timestamptz,
  pago_em       timestamptz,
  payload_json  jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_pagamentos_pedido on pagamentos (pedido_id);
create unique index if not exists uq_pagamentos_provedor_ref on pagamentos (provedor, provedor_ref) where provedor_ref is not null;
-- Só um pagamento vivo (pendente ou pago) por pedido.
create unique index if not exists uq_pagamentos_pedido_vivo on pagamentos (pedido_id) where status in ('pendente','pago');
-- Fila do worker: pendentes mais antigos primeiro.
create index if not exists idx_pagamentos_pendentes on pagamentos (expira_em) where status = 'pendente';

-- 027 criou a tabela pensando só na MaxiPago; vira fila genérica.
alter table pagamento_webhooks alter column origem drop default;
alter table pagamento_webhooks alter column origem set default 'desconhecida';

insert into schema_migrations (versao) values ('030') on conflict do nothing;
```

- [ ] **Step 2: Migração do banco de controle**

```sql
-- infra/sql/control/004_pagamento_provedores.sql
-- Provedor de pagamento online por tenant. config_json guarda só o que não é
-- segredo (chave PIX, expiração, caminho do arquivo de credencial no servidor
-- e o sha256 do segredo do webhook). O arquivo de credencial fica fora do repo.
create table if not exists pagamento_provedores (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  provedor    text not null,                         -- itau_pix | mock
  ativo       boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now(),
  unique (tenant_id, provedor)
);

insert into schema_migrations (versao) values ('004') on conflict do nothing;
```

- [ ] **Step 3: Tipos compartilhados**

Substituir o bloco `PEDIDO_STATUS` em `packages/shared-types/src/index.ts`:

```ts
export const PEDIDO_STATUS = [
  'AGUARDANDO_PAGAMENTO',
  'RECEBIDO',
  'ENVIADO_ERP',
  'ABERTO',
  'EM_FATURAMENTO',
  'FATURADO',
  'EM_SEPARACAO',
  'SAIU_ENTREGA',
  'ENTREGUE',
  'FALHA_INTEGRACAO',
  'CANCELADO',
] as const;
export type PedidoStatus = (typeof PEDIDO_STATUS)[number];

export type PagamentoStatus = 'pendente' | 'pago' | 'expirado' | 'cancelado' | 'falhou';
export type PagamentoMetodo = 'pix' | 'cartao';
```

- [ ] **Step 4: Aplicar no banco de dev e conferir**

```bash
psql "$DATABASE_URL_CAHU_DEV" -f infra/sql/tenant/030_pagamentos.sql
psql "$DATABASE_URL_CONTROL_DEV" -f infra/sql/control/004_pagamento_provedores.sql
psql "$DATABASE_URL_CAHU_DEV" -c "\d pagamentos" | head -20
```
Expected: tabela listada com as colunas acima. (Os valores de `DATABASE_URL_*` são os do `.env` local da API: `postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/fluxo_cahu` e `.../fluxo_control`.)

- [ ] **Step 5: Commit**

```bash
git add infra/sql/tenant/030_pagamentos.sql infra/sql/control/004_pagamento_provedores.sql packages/shared-types/src/index.ts
git commit -m "Tabelas de pagamento online e status AGUARDANDO_PAGAMENTO"
```

---

### Task 2: Contrato de provedor, BR Code e provedor mock

**Files:**
- Create: `apps/api/src/pagamentos/provedor-pagamento.ts`
- Create: `apps/api/src/pagamentos/br-code.ts`
- Create: `apps/api/src/pagamentos/br-code.spec.ts`
- Create: `apps/api/src/pagamentos/mock.provedor.ts`
- Create: `apps/api/src/pagamentos/mock.provedor.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ProvedorPagamento {
    readonly nome: string;
    criarCobranca(p: NovaCobranca): Promise<CobrancaCriada>;
    consultar(ref: string): Promise<SituacaoCobranca>;
    tratarWebhook(corpo: string): PagamentoRecebido[];
  }
  function montarBrCode(o: { location: string; nomeRecebedor: string; cidade: string; txid: string }): string
  ```

- [ ] **Step 1: Contrato**

```ts
// apps/api/src/pagamentos/provedor-pagamento.ts
/**
 * Contrato de provedor de pagamento online. O núcleo (PagamentosService) só
 * conhece isto; Itaú PIX é o primeiro provedor, e.Rede (cartão) entra depois
 * implementando a mesma interface.
 */
export interface NovaCobranca {
  ref: string;            // identificador nosso, vira txid/pedido no provedor
  valor: number;          // reais
  expiracaoSegundos: number;
  descricao: string;      // "Pedido #123 CAHU Delivery"
  pagador?: { documento: string; nome: string };
}

export interface CobrancaCriada {
  ref: string;
  copiaCola: string | null;   // BR Code; null pra métodos sem QR (cartão)
  expiraEm: Date;
  payload: unknown;           // resposta crua do provedor, vai pro payload_json
}

export type SituacaoStatus = 'pendente' | 'pago' | 'expirado' | 'cancelado';

export interface SituacaoCobranca {
  status: SituacaoStatus;
  valorPago?: number;
  pagoEm?: Date;
  payload: unknown;
}

export interface PagamentoRecebido {
  ref: string;
  valorPago: number;
  pagoEm: Date;
}

export interface ProvedorPagamento {
  readonly nome: string;
  readonly metodo: 'pix' | 'cartao';
  criarCobranca(p: NovaCobranca): Promise<CobrancaCriada>;
  consultar(ref: string): Promise<SituacaoCobranca>;
  /** Extrai as confirmações de um corpo de webhook. Corpo inválido => []. */
  tratarWebhook(corpo: string): PagamentoRecebido[];
}
```

- [ ] **Step 2: Teste do BR Code (falha primeiro)**

```ts
// apps/api/src/pagamentos/br-code.spec.ts
import { crc16, montarBrCode } from './br-code';

describe('br-code', () => {
  it('calcula o CRC16-CCITT do exemplo do manual do BCB', () => {
    // Exemplo oficial: payload sem CRC termina em "6304" e o CRC esperado é 1D3D
    const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-426655440000520400005303986540523.505802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16(semCrc)).toBe('1D3D');
  });

  it('monta um BR Code dinâmico a partir do location', () => {
    const codigo = montarBrCode({
      location: 'qrcodepix.itau.com.br/abc123',
      nomeRecebedor: 'CAHU DISTRIBUIDORA',
      cidade: 'RECIFE',
      txid: 'PED0000123ABCDEFGHIJKLMNOPQR',
    });
    expect(codigo.startsWith('000201')).toBe(true);
    expect(codigo).toContain('0014br.gov.bcb.pix');
    expect(codigo).toContain('2531qrcodepix.itau.com.br/abc123');
    expect(codigo).toContain('5918CAHU DISTRIBUIDORA');
    expect(codigo).toContain('6006RECIFE');
    expect(codigo).toContain('62320528PED0000123ABCDEFGHIJKLMNOPQR');
    expect(codigo).toMatch(/6304[0-9A-F]{4}$/);
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)));
  });

  it('corta nome e cidade nos limites do padrão (25 e 15)', () => {
    const codigo = montarBrCode({ location: 'x', nomeRecebedor: 'A'.repeat(40), cidade: 'B'.repeat(30), txid: 'T1' });
    expect(codigo).toContain('5925' + 'A'.repeat(25));
    expect(codigo).toContain('6015' + 'B'.repeat(15));
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
cd apps/api && npm test -- br-code
```
Expected: FAIL, `Cannot find module './br-code'`.

- [ ] **Step 4: Implementar o BR Code**

```ts
// apps/api/src/pagamentos/br-code.ts
/**
 * Monta o payload EMV "PIX copia e cola" de um QR dinâmico (BCB, Manual de
 * Padrões para Iniciação do Pix). Usado só quando o provedor não devolve o
 * campo pixCopiaECola pronto.
 */
function campo(id: string, valor: string): string {
  const len = valor.length.toString().padStart(2, '0');
  return `${id}${len}${valor}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), hex maiúsculo com 4 dígitos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
}

export function montarBrCode(o: { location: string; nomeRecebedor: string; cidade: string; txid: string }): string {
  const nome = semAcento(o.nomeRecebedor).slice(0, 25);
  const cidade = semAcento(o.cidade).slice(0, 15);
  const semCrc =
    campo('00', '01') +
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', o.location)) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('58', 'BR') +
    campo('59', nome) +
    campo('60', cidade) +
    campo('62', campo('05', o.txid)) +
    '6304';
  return semCrc + crc16(semCrc);
}
```

- [ ] **Step 5: Rodar e ver passar**

```bash
npm test -- br-code
```
Expected: PASS, 3 testes.

- [ ] **Step 6: Teste do provedor mock (falha primeiro)**

```ts
// apps/api/src/pagamentos/mock.provedor.spec.ts
import { MockProvedor } from './mock.provedor';

describe('MockProvedor', () => {
  it('cria cobrança com copia-e-cola fake e expiração pedida', async () => {
    const p = new MockProvedor();
    const antes = Date.now();
    const c = await p.criarCobranca({ ref: 'REF1', valor: 10.5, expiracaoSegundos: 60, descricao: 'x' });
    expect(c.ref).toBe('REF1');
    expect(c.copiaCola).toMatch(/^MOCKPIX-REF1-/);
    expect(c.expiraEm.getTime()).toBeGreaterThanOrEqual(antes + 60_000);
  });

  it('começa pendente e vira pago depois de simularPagamento', async () => {
    const p = new MockProvedor();
    await p.criarCobranca({ ref: 'REF2', valor: 1, expiracaoSegundos: 60, descricao: 'x' });
    expect((await p.consultar('REF2')).status).toBe('pendente');
    p.simularPagamento('REF2');
    const s = await p.consultar('REF2');
    expect(s.status).toBe('pago');
    expect(s.valorPago).toBe(1);
  });

  it('ref desconhecida consulta como cancelado', async () => {
    expect((await new MockProvedor().consultar('nada')).status).toBe('cancelado');
  });

  it('tratarWebhook aceita {ref, valor} e ignora lixo', () => {
    const p = new MockProvedor();
    expect(p.tratarWebhook(JSON.stringify({ ref: 'R', valor: 2 }))).toEqual([
      expect.objectContaining({ ref: 'R', valorPago: 2 }),
    ]);
    expect(p.tratarWebhook('não é json')).toEqual([]);
  });
});
```

- [ ] **Step 7: Implementar o mock**

```ts
// apps/api/src/pagamentos/mock.provedor.ts
import { CobrancaCriada, NovaCobranca, PagamentoRecebido, ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

/**
 * Provedor de desenvolvimento: nunca chama rede. O pagamento é confirmado por
 * simularPagamento() (endpoint admin) ou por um POST no webhook com {ref, valor}.
 */
export class MockProvedor implements ProvedorPagamento {
  readonly nome = 'mock';
  readonly metodo = 'pix' as const;
  private cobrancas = new Map<string, { valor: number; pago: boolean; pagoEm?: Date }>();

  async criarCobranca(p: NovaCobranca): Promise<CobrancaCriada> {
    this.cobrancas.set(p.ref, { valor: p.valor, pago: false });
    return {
      ref: p.ref,
      copiaCola: `MOCKPIX-${p.ref}-${p.valor.toFixed(2)}`,
      expiraEm: new Date(Date.now() + p.expiracaoSegundos * 1000),
      payload: { mock: true },
    };
  }

  async consultar(ref: string): Promise<SituacaoCobranca> {
    const c = this.cobrancas.get(ref);
    if (!c) return { status: 'cancelado', payload: { mock: true, motivo: 'ref desconhecida' } };
    if (c.pago) return { status: 'pago', valorPago: c.valor, pagoEm: c.pagoEm, payload: { mock: true } };
    return { status: 'pendente', payload: { mock: true } };
  }

  simularPagamento(ref: string) {
    const c = this.cobrancas.get(ref);
    if (c) {
      c.pago = true;
      c.pagoEm = new Date();
    }
  }

  tratarWebhook(corpo: string): PagamentoRecebido[] {
    try {
      const j = JSON.parse(corpo);
      if (typeof j?.ref !== 'string') return [];
      return [{ ref: j.ref, valorPago: Number(j.valor) || 0, pagoEm: new Date() }];
    } catch {
      return [];
    }
  }
}
```

- [ ] **Step 8: Rodar e commitar**

```bash
npm test -- pagamentos
git add apps/api/src/pagamentos
git commit -m "Contrato de provedor de pagamento, BR Code e provedor mock"
```
Expected: PASS, 7 testes.

---

### Task 3: PagamentosService (transições) com testes

**Files:**
- Create: `apps/api/src/pagamentos/pagamentos.service.ts`
- Create: `apps/api/src/pagamentos/pagamentos.service.spec.ts`

**Interfaces:**
- Consumes: `ProvedorPagamento` (Task 2).
- Produces:
  ```ts
  class PagamentosService {
    criarParaPedido(client: PoolClient, provedor: ProvedorPagamento, p: { pedidoId: string; numero: number; valor: number; expiracaoSegundos: number; appNome: string }): Promise<PagamentoResumo>
    confirmarPago(pool: Pool, pagamentoId: string, valorPago: number, pagoEm: Date): Promise<boolean>
    expirar(pool: Pool, pagamentoId: string): Promise<boolean>
    aplicarSituacao(pool: Pool, pagamento: { id: string; expira_em: Date }, s: SituacaoCobranca): Promise<void>
    gerarRef(numero: number): string
  }
  interface PagamentoResumo { id; metodo; status; valor; copiaCola; expiraEm; pagoEm }
  ```

- [ ] **Step 1: Teste (falha primeiro)**

```ts
// apps/api/src/pagamentos/pagamentos.service.spec.ts
import type { Pool, PoolClient } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';

function fakePool(respostas: Array<{ rows?: any[]; rowCount?: number }>) {
  const query = jest.fn();
  respostas.forEach((r) => query.mockResolvedValueOnce({ rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows?.length ?? 0) }));
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  return { pool: { query } as unknown as Pool, query };
}

describe('PagamentosService', () => {
  const svc = new PagamentosService();

  it('gerarRef: 26 a 35 caracteres alfanuméricos com o número do pedido', () => {
    const ref = svc.gerarRef(123);
    expect(ref).toMatch(/^[A-Za-z0-9]{26,35}$/);
    expect(ref.startsWith('PED000123')).toBe(true);
  });

  it('criarParaPedido: chama o provedor e grava a linha em pagamentos', async () => {
    const { pool, query } = fakePool([{ rows: [{ id: 'pag-1' }] }]);
    const prov = new MockProvedor();
    const r = await svc.criarParaPedido(pool as unknown as PoolClient, prov, {
      pedidoId: 'ped-1', numero: 7, valor: 99.9, expiracaoSegundos: 1800, appNome: 'CAHU Delivery',
    });
    expect(r.id).toBe('pag-1');
    expect(r.status).toBe('pendente');
    expect(r.copiaCola).toMatch(/^MOCKPIX-PED000007/);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('insert into pagamentos');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['ped-1', 'mock', 'pix', 99.9]));
  });

  it('confirmarPago: só transiciona se ainda pendente, e move o pedido pra RECEBIDO', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 }, // update pagamentos ... returning pedido_id
    ]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date('2026-09-25T14:32:00Z'));
    expect(ok).toBe(true);
    expect(query.mock.calls[0][0]).toContain("status = 'pendente'");
    expect(query.mock.calls[1][0]).toContain("set status = 'RECEBIDO'");
    expect(query.mock.calls[2][0]).toContain('insert into pedido_eventos');
    expect(query.mock.calls[2][1]).toEqual(['ped-1', 'RECEBIDO', 'PIX pago']);
  });

  it('confirmarPago repetido: não gera evento duplicado', async () => {
    const { pool, query } = fakePool([{ rows: [], rowCount: 0 }]);
    const ok = await svc.confirmarPago(pool, 'pag-1', 99.9, new Date());
    expect(ok).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('expirar: cancela o pedido e estorna o saldo usado', async () => {
    const { pool, query } = fakePool([
      { rows: [{ pedido_id: 'ped-1' }], rowCount: 1 },
      { rows: [{ cliente_id: 'cli-1', valor_saldo_usado: '15.00', numero: 7 }] },
    ]);
    const ok = await svc.expirar(pool, 'pag-1');
    expect(ok).toBe(true);
    const sqls = query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes("set status = 'CANCELADO'"))).toBe(true);
    expect(sqls.some((s) => s.includes('insert into carteira_movimentos'))).toBe(true);
    const estorno = query.mock.calls.find((c) => (c[0] as string).includes('carteira_movimentos'));
    expect(estorno![1]).toEqual(['cli-1', 15, 'Estorno: PIX expirado (pedido #7)', 'ped-1']);
  });

  it('aplicarSituacao: pendente vencido vira expirado; pago confirma', async () => {
    const exp = jest.spyOn(svc, 'expirar').mockResolvedValue(true);
    const pago = jest.spyOn(svc, 'confirmarPago').mockResolvedValue(true);
    const { pool } = fakePool([]);
    await svc.aplicarSituacao(pool, { id: 'p1', expira_em: new Date(Date.now() - 1000) }, { status: 'pendente', payload: {} });
    expect(exp).toHaveBeenCalledWith(pool, 'p1');
    await svc.aplicarSituacao(pool, { id: 'p2', expira_em: new Date(Date.now() + 1000) }, { status: 'pendente', payload: {} });
    expect(exp).toHaveBeenCalledTimes(1);
    await svc.aplicarSituacao(pool, { id: 'p3', expira_em: new Date() }, { status: 'pago', valorPago: 5, pagoEm: new Date(), payload: {} });
    expect(pago).toHaveBeenCalledWith(pool, 'p3', 5, expect.any(Date));
    exp.mockRestore(); pago.mockRestore();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- pagamentos.service
```
Expected: FAIL, `Cannot find module './pagamentos.service'`.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/pagamentos/pagamentos.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

export interface PagamentoResumo {
  id: string;
  metodo: 'pix' | 'cartao';
  status: 'pendente' | 'pago' | 'expirado' | 'cancelado' | 'falhou';
  valor: number;
  copiaCola: string | null;
  expiraEm: Date;
  pagoEm: Date | null;
}

type Executor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

/**
 * Transições do pagamento. Toda transição usa `where status = 'pendente'`:
 * webhook repetido, consulta concorrente e clique duplo não geram evento duplicado.
 * O pedido segue o pagamento: pago => RECEBIDO (Dlinks passa a ver), expirado => CANCELADO + estorno.
 */
@Injectable()
export class PagamentosService {
  private readonly log = new Logger('PagamentosService');

  /** txid do Itaú: 26–35 chars [A-Za-z0-9]. "PED" + número com 6 dígitos + 20 aleatórios = 29. */
  gerarRef(numero: number): string {
    const aleatorio = randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20).padEnd(20, 'X');
    return `PED${String(numero).padStart(6, '0')}${aleatorio}`;
  }

  async criarParaPedido(
    client: Executor,
    provedor: ProvedorPagamento,
    p: { pedidoId: string; numero: number; valor: number; expiracaoSegundos: number; appNome: string },
  ): Promise<PagamentoResumo> {
    const ref = this.gerarRef(p.numero);
    const cob = await provedor.criarCobranca({
      ref,
      valor: p.valor,
      expiracaoSegundos: p.expiracaoSegundos,
      descricao: `Pedido #${p.numero} ${p.appNome}`,
    });
    const { rows } = await client.query(
      `insert into pagamentos (pedido_id, provedor, metodo, status, valor, provedor_ref, copia_cola, expira_em, payload_json)
       values ($1,$2,$3,'pendente',$4,$5,$6,$7,$8) returning id`,
      [p.pedidoId, provedor.nome, provedor.metodo, p.valor, cob.ref, cob.copiaCola, cob.expiraEm, JSON.stringify(cob.payload ?? null)],
    );
    return {
      id: rows[0].id, metodo: provedor.metodo, status: 'pendente', valor: p.valor,
      copiaCola: cob.copiaCola, expiraEm: cob.expiraEm, pagoEm: null,
    };
  }

  /** pendente -> pago. Retorna false se já não estava pendente (idempotente). */
  async confirmarPago(pool: Executor, pagamentoId: string, valorPago: number, pagoEm: Date): Promise<boolean> {
    const up = await pool.query(
      `update pagamentos set status = 'pago', valor_pago = $2, pago_em = $3, atualizado_em = now()
        where id = $1 and status = 'pendente' returning pedido_id`,
      [pagamentoId, valorPago, pagoEm],
    );
    if (up.rowCount === 0) return false;
    const pedidoId = up.rows[0].pedido_id;
    await pool.query(`update pedidos set status = 'RECEBIDO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'sistema')`,
      [pedidoId, 'RECEBIDO', 'PIX pago'],
    );
    this.log.log(`pagamento ${pagamentoId} pago (pedido ${pedidoId})`);
    return true;
  }

  /** pendente -> expirado; pedido -> CANCELADO; estorna saldo de carteira usado. */
  async expirar(pool: Executor, pagamentoId: string): Promise<boolean> {
    const up = await pool.query(
      `update pagamentos set status = 'expirado', atualizado_em = now()
        where id = $1 and status = 'pendente' returning pedido_id`,
      [pagamentoId],
    );
    if (up.rowCount === 0) return false;
    const pedidoId = up.rows[0].pedido_id;
    const ped = await pool.query(`select cliente_id, valor_saldo_usado, numero from pedidos where id = $1`, [pedidoId]);
    await pool.query(`update pedidos set status = 'CANCELADO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO','PIX expirado','sistema')`,
      [pedidoId],
    );
    const saldo = Number(ped.rows[0]?.valor_saldo_usado) || 0;
    if (saldo > 0) {
      await pool.query(
        `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1,$2,$3,$4)`,
        [ped.rows[0].cliente_id, saldo, `Estorno: PIX expirado (pedido #${ped.rows[0].numero})`, pedidoId],
      );
    }
    this.log.log(`pagamento ${pagamentoId} expirado (pedido ${pedidoId})`);
    return true;
  }

  /** Traduz o que o provedor respondeu numa transição. */
  async aplicarSituacao(pool: Executor, pagamento: { id: string; expira_em: Date }, s: SituacaoCobranca): Promise<void> {
    if (s.status === 'pago') {
      await this.confirmarPago(pool, pagamento.id, s.valorPago ?? 0, s.pagoEm ?? new Date());
      return;
    }
    if (s.status === 'expirado' || s.status === 'cancelado') {
      await this.expirar(pool, pagamento.id);
      return;
    }
    // pendente no provedor, mas já passou do prazo: o Itaú não aceita mais pagamento.
    if (new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id);
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar; commit**

```bash
npm test -- pagamentos.service
git add apps/api/src/pagamentos/pagamentos.service.ts apps/api/src/pagamentos/pagamentos.service.spec.ts
git commit -m "PagamentosService: criação, confirmação e expiração idempotentes"
```
Expected: PASS, 6 testes.

---

### Task 4: Provedor Itaú PIX e registro de provedores por tenant

**Files:**
- Create: `apps/api/src/pagamentos/itau-pix.provedor.ts`
- Create: `apps/api/src/pagamentos/itau-pix.provedor.spec.ts`
- Create: `apps/api/src/pagamentos/provedores.service.ts`
- Create: `apps/api/src/pagamentos/pagamentos.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces:
  ```ts
  class ItauPixProvedor implements ProvedorPagamento  // constructor(cfg: ItauPixConfig)
  interface ItauPixConfig { chavePix; nomeRecebedor; cidade; clientId; clientSecret; pfx: Buffer; pfxSenha; baseUrl?: string }
  class ProvedoresService { obter(slug: string): Promise<ProvedorPagamento | null>; segredoWebhookHash(slug): Promise<string|null> }
  ```

- [ ] **Step 1: Teste da parte pura do provedor Itaú (falha primeiro)**

```ts
// apps/api/src/pagamentos/itau-pix.provedor.spec.ts
import { ItauPixProvedor, traduzirStatusItau } from './itau-pix.provedor';

const cfg = {
  chavePix: '61920643000148', nomeRecebedor: 'CAHU DISTRIBUIDORA', cidade: 'RECIFE',
  clientId: 'cid', clientSecret: 'sec', pfx: Buffer.from(''), pfxSenha: 'x',
};

describe('ItauPixProvedor', () => {
  it('tratarWebhook extrai txid/valor/horario de cada pix', () => {
    const p = new ItauPixProvedor(cfg);
    const corpo = JSON.stringify({
      pix: [
        { endToEndId: 'E1', txid: 'PED000001AAAA', valor: '99.90', horario: '2026-09-25T14:32:00.000Z' },
        { endToEndId: 'E2', txid: 'PED000002BBBB', valor: '1.00', horario: '2026-09-25T15:00:00.000Z' },
      ],
    });
    const r = p.tratarWebhook(corpo);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ ref: 'PED000001AAAA', valorPago: 99.9, pagoEm: new Date('2026-09-25T14:32:00.000Z') });
  });

  it('tratarWebhook ignora corpo sem pix ou inválido', () => {
    const p = new ItauPixProvedor(cfg);
    expect(p.tratarWebhook('{}')).toEqual([]);
    expect(p.tratarWebhook('<xml/>')).toEqual([]);
    expect(p.tratarWebhook(JSON.stringify({ pix: [{ endToEndId: 'E' }] }))).toEqual([]);
  });

  it('traduz os status do Itaú', () => {
    expect(traduzirStatusItau({ status: 'ATIVA' }).status).toBe('pendente');
    expect(traduzirStatusItau({ status: 'REMOVIDA_PELO_PSP' }).status).toBe('expirado');
    expect(traduzirStatusItau({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }).status).toBe('cancelado');
    const pago = traduzirStatusItau({ status: 'CONCLUIDA', pix: [{ valor: '12.34', horario: '2026-09-25T10:00:00Z' }] });
    expect(pago.status).toBe('pago');
    expect(pago.valorPago).toBe(12.34);
    expect(pago.pagoEm).toEqual(new Date('2026-09-25T10:00:00Z'));
  });

  it('copiaColaDaResposta usa pixCopiaECola se vier, senão monta do location', () => {
    const p = new ItauPixProvedor(cfg);
    expect(p.copiaColaDaResposta({ pixCopiaECola: '000201...' }, 'T')).toBe('000201...');
    const montado = p.copiaColaDaResposta({ location: 'qrcodepix.itau.com.br/x' }, 'PED000001AAAAAAAAAAAAAAAAAAAAA');
    expect(montado).toContain('br.gov.bcb.pix');
    expect(montado).toContain('qrcodepix.itau.com.br/x');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
npm test -- itau-pix
```
Expected: FAIL, módulo não encontrado.

- [ ] **Step 3: Implementar o provedor Itaú**

```ts
// apps/api/src/pagamentos/itau-pix.provedor.ts
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { montarBrCode } from './br-code';
import { CobrancaCriada, NovaCobranca, PagamentoRecebido, ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

export interface ItauPixConfig {
  chavePix: string;
  nomeRecebedor: string;
  cidade: string;
  clientId: string;
  clientSecret: string;
  pfx: Buffer;
  pfxSenha: string;
  /** Produção: https://secure.api.itau/pix_recebimentos/v2 (confirmar no 1º teste real; devportal itau-ep9-api-regulatorio-pix-v2-externo). */
  baseUrl?: string;
}

const STS_HOST = 'sts.itau.com.br';
const BASE_PADRAO = 'https://secure.api.itau/pix_recebimentos/v2';

interface RespostaHttp { status: number; body: any; texto: string }

/** Cobrança imediata (cob) na API PIX Recebimentos v2 do Itaú, com mTLS pelo .pfx do certificado dinâmico. */
export class ItauPixProvedor implements ProvedorPagamento {
  readonly nome = 'itau_pix';
  readonly metodo = 'pix' as const;
  private readonly log = new Logger('ItauPixProvedor');
  private token: { valor: string; expiraEm: number } | null = null;

  constructor(private readonly cfg: ItauPixConfig) {}

  async criarCobranca(p: NovaCobranca): Promise<CobrancaCriada> {
    const corpo = {
      calendario: { expiracao: p.expiracaoSegundos },
      valor: { original: p.valor.toFixed(2) },
      chave: this.cfg.chavePix,
      solicitacaoPagador: p.descricao.slice(0, 140),
      ...(p.pagador ? { devedor: p.pagador.documento.length > 11 ? { cnpj: p.pagador.documento, nome: p.pagador.nome } : { cpf: p.pagador.documento, nome: p.pagador.nome } } : {}),
    };
    const r = await this.chamar('PUT', `/cob/${p.ref}`, corpo);
    if (r.status < 200 || r.status >= 300) {
      throw new Error(`Itaú PIX cob ${r.status}: ${r.texto.slice(0, 300)}`);
    }
    const criacao = r.body?.calendario?.criacao ? new Date(r.body.calendario.criacao) : new Date();
    const expiracao = Number(r.body?.calendario?.expiracao) || p.expiracaoSegundos;
    return {
      ref: r.body?.txid ?? p.ref,
      copiaCola: this.copiaColaDaResposta(r.body, p.ref),
      expiraEm: new Date(criacao.getTime() + expiracao * 1000),
      payload: r.body,
    };
  }

  async consultar(ref: string): Promise<SituacaoCobranca> {
    const r = await this.chamar('GET', `/cob/${ref}`);
    if (r.status === 404) return { status: 'cancelado', payload: r.body };
    if (r.status < 200 || r.status >= 300) throw new Error(`Itaú PIX consulta ${r.status}: ${r.texto.slice(0, 300)}`);
    return traduzirStatusItau(r.body);
  }

  /** Corpo do webhook do Itaú: { "pix": [ { endToEndId, txid, valor, horario, ... } ] } */
  tratarWebhook(corpo: string): PagamentoRecebido[] {
    let j: any;
    try { j = JSON.parse(corpo); } catch { return []; }
    if (!Array.isArray(j?.pix)) return [];
    return j.pix
      .filter((x: any) => typeof x?.txid === 'string')
      .map((x: any) => ({ ref: x.txid, valorPago: Number(x.valor) || 0, pagoEm: x.horario ? new Date(x.horario) : new Date() }));
  }

  copiaColaDaResposta(body: any, txid: string): string | null {
    if (typeof body?.pixCopiaECola === 'string' && body.pixCopiaECola.length > 0) return body.pixCopiaECola;
    if (typeof body?.location === 'string' && body.location.length > 0) {
      return montarBrCode({ location: body.location, nomeRecebedor: this.cfg.nomeRecebedor, cidade: this.cfg.cidade, txid });
    }
    return null;
  }

  /** Registro único do webhook (setup): PUT /webhook/{chave} { webhookUrl }. */
  async registrarWebhook(webhookUrl: string): Promise<RespostaHttp> {
    return this.chamar('PUT', `/webhook/${this.cfg.chavePix}`, { webhookUrl });
  }

  // ---- HTTP ----

  private async obterToken(): Promise<string> {
    if (this.token && this.token.expiraEm > Date.now()) return this.token.valor;
    const body = `grant_type=client_credentials&client_id=${encodeURIComponent(this.cfg.clientId)}&client_secret=${encodeURIComponent(this.cfg.clientSecret)}`;
    const r = await this.requisicao({
      hostname: STS_HOST, path: '/api/oauth/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, body);
    if (r.status !== 200 || !r.body?.access_token) throw new Error(`Itaú STS ${r.status}: ${r.texto.slice(0, 200)}`);
    // expires_in = 300; renova com 1 min de folga.
    this.token = { valor: r.body.access_token, expiraEm: Date.now() + (Number(r.body.expires_in) || 300) * 1000 - 60_000 };
    return this.token.valor;
  }

  private async chamar(method: 'GET' | 'PUT' | 'POST', caminho: string, corpo?: unknown): Promise<RespostaHttp> {
    const tentar = async (): Promise<RespostaHttp> => {
      const token = await this.obterToken();
      const base = new URL(this.cfg.baseUrl ?? BASE_PADRAO);
      const data = corpo === undefined ? undefined : JSON.stringify(corpo);
      return this.requisicao({
        hostname: base.hostname, path: `${base.pathname.replace(/\/$/, '')}${caminho}`, method,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-itau-apikey': this.cfg.clientId,
          'x-itau-correlationID': randomUUID(),
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        },
      }, data);
    };
    let r = await tentar();
    if (r.status === 401) { // token invalidado no meio: renova uma vez
      this.token = null;
      r = await tentar();
    }
    return r;
  }

  private requisicao(opts: https.RequestOptions, data?: string): Promise<RespostaHttp> {
    return new Promise((resolve, reject) => {
      const req = https.request({ ...opts, port: 443, pfx: this.cfg.pfx, passphrase: this.cfg.pfxSenha }, (res) => {
        let texto = '';
        res.on('data', (c) => (texto += c));
        res.on('end', () => {
          let body: any = null;
          try { body = texto ? JSON.parse(texto) : null; } catch { body = null; }
          resolve({ status: res.statusCode ?? 0, body, texto });
        });
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }
}

export function traduzirStatusItau(body: any): SituacaoCobranca {
  const st = String(body?.status ?? '');
  if (st === 'CONCLUIDA') {
    const pix = Array.isArray(body?.pix) && body.pix.length ? body.pix[body.pix.length - 1] : null;
    return {
      status: 'pago',
      valorPago: pix ? Number(pix.valor) || 0 : Number(body?.valor?.original) || 0,
      pagoEm: pix?.horario ? new Date(pix.horario) : new Date(),
      payload: body,
    };
  }
  if (st === 'REMOVIDA_PELO_PSP') return { status: 'expirado', payload: body };
  if (st === 'REMOVIDA_PELO_USUARIO_RECEBEDOR') return { status: 'cancelado', payload: body };
  return { status: 'pendente', payload: body };
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
npm test -- itau-pix
```
Expected: PASS, 4 testes.

- [ ] **Step 5: Registro de provedores por tenant**

```ts
// apps/api/src/pagamentos/provedores.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { DatabaseService } from '../database/database.service';
import { ItauPixProvedor } from './itau-pix.provedor';
import { MockProvedor } from './mock.provedor';
import { ProvedorPagamento } from './provedor-pagamento';

interface ConfigItau {
  chavePix: string;
  nomeRecebedor?: string;
  cidade?: string;
  expiracaoSegundos?: number;
  credencialArquivo: string;     // JSON fora do repo: { clientId, clientSecret, pfxArquivo, pfxSenha }
  webhookSegredoHash?: string;   // sha256 do segredo que vai na URL do webhook
  baseUrl?: string;
}

export interface ProvedorDoTenant {
  provedor: ProvedorPagamento;
  expiracaoSegundos: number;
}

/**
 * Lê pagamento_provedores (banco de controle) e instancia o provedor do tenant
 * uma vez. Tenant sem linha ativa => null => checkout segue o fluxo antigo.
 */
@Injectable()
export class ProvedoresService {
  private readonly log = new Logger('ProvedoresService');
  private cache = new Map<string, ProvedorDoTenant | null>();

  constructor(private readonly db: DatabaseService) {}

  async obter(slug: string): Promise<ProvedorDoTenant | null> {
    if (this.cache.has(slug)) return this.cache.get(slug)!;
    const { rows } = await this.db.controlPool().query(
      `select pp.provedor, pp.config_json from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id
        where t.slug = $1 and pp.ativo = true order by pp.criado_em limit 1`,
      [slug],
    );
    let r: ProvedorDoTenant | null = null;
    if (rows[0]) {
      const cfg = rows[0].config_json ?? {};
      const expiracaoSegundos = Number(cfg.expiracaoSegundos) || 1800;
      if (rows[0].provedor === 'mock') r = { provedor: new MockProvedor(), expiracaoSegundos };
      else if (rows[0].provedor === 'itau_pix') r = { provedor: this.itau(cfg as ConfigItau), expiracaoSegundos };
      else this.log.warn(`provedor desconhecido pro tenant ${slug}: ${rows[0].provedor}`);
    }
    this.cache.set(slug, r);
    return r;
  }

  /** sha256 do segredo do webhook, pra middleware conferir. */
  async segredoWebhookHash(slug: string): Promise<string | null> {
    const { rows } = await this.db.controlPool().query(
      `select pp.config_json->>'webhookSegredoHash' as h from pagamento_provedores pp
         join tenants t on t.id = pp.tenant_id where t.slug = $1 and pp.ativo = true limit 1`,
      [slug],
    );
    return rows[0]?.h ?? null;
  }

  /** Resolve o tenant a partir do hash do segredo da URL. */
  async slugPorSegredoHash(hash: string): Promise<string | null> {
    const { rows } = await this.db.controlPool().query(
      `select t.slug from pagamento_provedores pp join tenants t on t.id = pp.tenant_id
        where pp.ativo = true and pp.config_json->>'webhookSegredoHash' = $1 limit 1`,
      [hash],
    );
    return rows[0]?.slug ?? null;
  }

  private itau(cfg: ConfigItau): ItauPixProvedor {
    const cred = JSON.parse(readFileSync(cfg.credencialArquivo, 'utf8'));
    return new ItauPixProvedor({
      chavePix: cfg.chavePix,
      nomeRecebedor: cfg.nomeRecebedor ?? 'CAHU DISTRIBUIDORA',
      cidade: cfg.cidade ?? 'RECIFE',
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
      pfx: readFileSync(cred.pfxArquivo),
      pfxSenha: cred.pfxSenha,
      baseUrl: cfg.baseUrl,
    });
  }
}
```

- [ ] **Step 6: Módulo**

```ts
// apps/api/src/pagamentos/pagamentos.module.ts
import { Module } from '@nestjs/common';
import { PagamentosService } from './pagamentos.service';
import { ProvedoresService } from './provedores.service';

@Module({
  providers: [PagamentosService, ProvedoresService],
  exports: [PagamentosService, ProvedoresService],
})
export class PagamentosModule {}
```

Em `apps/api/src/app.module.ts`, adicionar o import e incluir `PagamentosModule` na lista `imports`:

```ts
import { PagamentosModule } from './pagamentos/pagamentos.module';
// ...
imports: [DatabaseModule, IntegrationModule, AuthModule, CatalogModule, OrdersModule, ProfileModule, AdminModule, DlinksModule, GeoModule, MaxipagoModule, MunicipiosModule, PagamentosModule],
```

- [ ] **Step 7: Build e commit**

```bash
npm run build && git add apps/api/src/pagamentos apps/api/src/app.module.ts
git commit -m "Provedor Itau PIX (mTLS, cob, consulta, webhook) e registro por tenant"
```
Expected: build sem erro.

---

### Task 5: Checkout cria o pagamento; pedido e Dlinks respeitam AGUARDANDO_PAGAMENTO

**Files:**
- Modify: `apps/api/src/orders/orders.service.ts` (criarPedido ~L86-205, listar ~L212, detalhe ~L236)
- Modify: `apps/api/src/orders/orders.module.ts` (importar PagamentosModule)
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts:41-60`
- Create: `apps/api/src/integracoes-dlinks/dlinks-pedidos.listar.spec.ts`

**Interfaces:**
- Consumes: `PagamentosService.criarParaPedido`, `ProvedoresService.obter` (Tasks 3, 4).
- Produces: `POST /pedidos` responde `{ id, numero, status, criado_em, pagamento? }`; `GET /pedidos/:id` e `GET /pedidos` devolvem `pagamento` (objeto ou null); `GET /integracoes/dlinks/pedidos` exclui AGUARDANDO_PAGAMENTO e inclui `pagamentoOnline`.

- [ ] **Step 1: Injetar os serviços no OrdersService**

Em `orders.module.ts` adicionar `PagamentosModule` em `imports`. Em `orders.service.ts`:

```ts
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
// no construtor da classe OrdersService, acrescentar:
constructor(
  /* ...deps existentes... */
  private readonly pagamentos: PagamentosService,
  private readonly provedores: ProvedoresService,
) {}
```
(Se a classe não tinha construtor, criar só com esses dois.)

- [ ] **Step 2: Decidir o status inicial e criar o pagamento dentro da transação**

Em `criarPedido`, logo antes do `insert into pedidos` (após calcular `valorSaldoUsado`):

```ts
      const { tenant } = tenantCtx();
      const provedorTenant = dto.formaPagamento === 'pix' ? await this.provedores.obter(tenant.slug) : null;
      const valorACobrar = Number((subtotal - valorSaldoUsado).toFixed(2));
      // PIX online só quando o tenant tem provedor e sobra algo a pagar depois do saldo.
      const pagarOnline = !!provedorTenant && valorACobrar > 0;
      const statusInicial = pagarOnline ? 'AGUARDANDO_PAGAMENTO' : 'RECEBIDO';
```

Trocar o `insert into pedidos` pra gravar o status:

```ts
      const ped = await client.query(
        `insert into pedidos (cliente_id, endereco_snapshot_json, forma_pagamento, tipo_entrega, subtotal, total, observacoes, condicao_pagamento, valor_saldo_usado, status)
         values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9) returning id, numero, status, criado_em`,
        [
          clienteId, enderecoJson, dto.formaPagamento, tipoEntrega, subtotal,
          dto.observacoes ?? null,
          dto.formaPagamento === 'boleto' ? (dto.condicaoPagamento ?? 'À vista') : null,
          valorSaldoUsado,
          statusInicial,
        ],
      );
```

Trocar o evento `RECEBIDO` fixo por:

```ts
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'app')`,
        [pedidoId, statusInicial, pagarOnline ? 'Pedido recebido, aguardando pagamento PIX' : 'Pedido recebido'],
      );
```

Depois do `insert into sync_outbox` e antes do `delete from carrinho_itens`:

```ts
      let pagamento: import('../pagamentos/pagamentos.service').PagamentoResumo | null = null;
      if (pagarOnline) {
        // Falhou no Itaú => exceção => rollback: pedido não existe, app pede pra tentar de novo.
        try {
          pagamento = await this.pagamentos.criarParaPedido(client, provedorTenant!.provedor, {
            pedidoId, numero: ped.rows[0].numero, valor: valorACobrar,
            expiracaoSegundos: provedorTenant!.expiracaoSegundos, appNome: tenant.appNome,
          });
        } catch (e) {
          throw new BadRequestException('Não foi possível gerar o PIX agora. Tente novamente em instantes.');
        }
      }
```

E o `return ped.rows[0];` vira `return { ...ped.rows[0], pagamento };`.

- [ ] **Step 3: Expor o pagamento em `listar` e `detalhe`**

Em `listar`, a query vira:

```ts
      `select p.id, p.numero, p.status, p.forma_pagamento, p.total, p.criado_em,
              (select json_build_object('id', g.id, 'metodo', g.metodo, 'status', g.status, 'valor', g.valor,
                      'copiaCola', g.copia_cola, 'expiraEm', g.expira_em, 'pagoEm', g.pago_em)
                 from pagamentos g where g.pedido_id = p.id order by g.criado_em desc limit 1) as pagamento
         from pedidos p where p.cliente_id = $1 order by p.criado_em desc limit 20 offset $2`,
```

Em `detalhe`, acrescentar depois da subquery `nota`:

```ts
        (select json_build_object('id', g.id, 'metodo', g.metodo, 'status', g.status, 'valor', g.valor,
                'copiaCola', g.copia_cola, 'expiraEm', g.expira_em, 'pagoEm', g.pago_em)
           from pagamentos g where g.pedido_id = p.id order by g.criado_em desc limit 1) as pagamento
```

- [ ] **Step 4: Teste do filtro do Dlinks (falha primeiro)**

```ts
// apps/api/src/integracoes-dlinks/dlinks-pedidos.listar.spec.ts
import type { Pool } from 'pg';
import type { TenantInfo } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';
import { DlinksPedidosService } from './dlinks-pedidos.service';

const tenant: TenantInfo = { id: 'uuid', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

describe('DlinksPedidosService.listar', () => {
  it('não lista pedidos aguardando pagamento e expõe pagamentoOnline', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{
        id: 'p1', numero: 9, criado_em: new Date(), tipo_entrega: 'entrega', forma_pagamento: 'pix', condicao_pagamento: null,
        endereco_snapshot_json: null, valor_saldo_usado: '0', documento: '123', erp_cliente_id: 'C1', tipo: 'PJ',
        razao_social: 'X', nome_fantasia: 'X', email: null, telefone: null, itens: [],
        pagamento_online: { status: 'pago', pagoEm: '2026-09-25T14:32:00Z', txid: 'PED000009AAA', valor: 99.9 },
      }] })
      .mockResolvedValue({ rows: [] });
    const svc = new DlinksPedidosService();
    const out = await runComTenant({ tenant, pool: { query } as unknown as Pool }, () => svc.listar('2026-09-25', '2026-09-25'));
    expect(query.mock.calls[0][0]).toContain("p.status <> 'AGUARDANDO_PAGAMENTO'");
    expect(out.pedidos[0]).toEqual(expect.objectContaining({ pagamentoOnline: expect.objectContaining({ status: 'pago', txid: 'PED000009AAA' }) }));
  });
});
```
Se o construtor de `DlinksPedidosService` exigir dependências, passar `undefined as any` pra cada uma: `listar` só usa `tenantCtx()`.

- [ ] **Step 5: Rodar e ver falhar**

```bash
npm test -- dlinks-pedidos.listar
```
Expected: FAIL no `toContain("p.status <> 'AGUARDANDO_PAGAMENTO'")`.

- [ ] **Step 6: Alterar a query do `listar` e o mapeamento**

Na query de `listar` em `dlinks-pedidos.service.ts`, acrescentar a subquery e o filtro:

```ts
      `select p.id, p.numero, p.criado_em, p.tipo_entrega, p.forma_pagamento, p.condicao_pagamento,
              p.endereco_snapshot_json, p.valor_saldo_usado,
              c.documento, c.erp_cliente_id, c.tipo, c.razao_social, c.nome_fantasia, c.email, c.telefone,
              (select json_agg(json_build_object(
                  'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                  'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i join produtos pr on pr.id = i.produto_id
                where i.pedido_id = p.id) as itens,
              (select json_build_object('status', g.status, 'pagoEm', g.pago_em, 'txid', g.provedor_ref, 'valor', g.valor_pago)
                 from pagamentos g where g.pedido_id = p.id and g.status = 'pago' order by g.pago_em desc limit 1) as pagamento_online
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em >= ($1::date)::timestamp at time zone 'America/Recife'
          and p.criado_em < ($2::date + 1)::timestamp at time zone 'America/Recife'
          and p.status <> 'AGUARDANDO_PAGAMENTO'
        order by p.criado_em`,
```

No `map` que monta `PedidoDlinks` (por volta da linha 79, onde está `formaPagamento: r.forma_pagamento`), acrescentar:

```ts
        pagamentoOnline: r.pagamento_online ?? undefined,
```

E na interface `PedidoDlinks` (linha ~23):

```ts
  /** Presente só quando o pedido foi pago online no app antes de chegar aqui. Opcional; o Dlinks pode ignorar. */
  pagamentoOnline?: { status: 'pago'; pagoEm: string; txid: string; valor: number };
```

- [ ] **Step 7: Rodar tudo, build, commit**

```bash
npm test 2>&1 | tail -5 && npm run build
git add apps/api/src/orders apps/api/src/integracoes-dlinks
git commit -m "Checkout PIX cria cobranca e segura o pedido ate o pagamento; Dlinks so ve pedido pago"
```

---

### Task 6: Webhook do Itaú e processador da fila

**Files:**
- Create: `apps/api/src/pagamentos/webhook-auth.middleware.ts`
- Create: `apps/api/src/pagamentos/webhook.controller.ts`
- Create: `apps/api/src/pagamentos/webhooks.processor.ts`
- Create: `apps/api/src/pagamentos/webhooks.processor.spec.ts`
- Modify: `apps/api/src/pagamentos/pagamentos.module.ts`
- Modify: `apps/api/src/app.module.ts` (exclude do TenancyMiddleware)

**Interfaces:**
- Produces: `POST /v1/integracoes/pagamentos/:segredo/webhook` e `.../webhook/pix` (o Itaú concatena `/pix` na URL cadastrada). `WebhooksProcessor.processarPendentes(slug)`.

- [ ] **Step 1: Middleware de segredo na URL (mesmo padrão MaxiPago, resolvendo por `pagamento_provedores`)**

```ts
// apps/api/src/pagamentos/webhook-auth.middleware.ts
import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';
import { ProvedoresService } from './provedores.service';

/** Tenant vem do segredo no caminho: /v1/integracoes/pagamentos/<segredo>/webhook[/pix]. */
@Injectable()
export class WebhookAuthMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService, private readonly provedores: ProvedoresService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const segredo = segredoDaUrl(req.originalUrl);
    if (!segredo) throw new UnauthorizedException('Segredo ausente');
    const hash = createHash('sha256').update(segredo).digest('hex');
    const slug = await this.provedores.slugPorSegredoHash(hash);
    if (!slug) throw new UnauthorizedException('Segredo inválido');
    const tenant = await this.db.getTenant(slug);
    const pool = await this.db.getTenantPool(slug);
    await runComTenant({ tenant, pool }, async () => next());
  }
}

function segredoDaUrl(url: string): string | undefined {
  const partes = url.split('?')[0].split('/').filter(Boolean);
  const i = partes.indexOf('pagamentos');
  return i >= 0 ? partes[i + 1] : undefined;
}
```

- [ ] **Step 2: Controller**

```ts
// apps/api/src/pagamentos/webhook.controller.ts
import { Controller, Headers, HttpCode, Ip, Logger, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { tenantCtx } from '../tenancy/tenant-context';

/**
 * Recebe o webhook do provedor, grava cru em pagamento_webhooks e responde 200.
 * O processamento é assíncrono (WebhooksProcessor) — provedor que recebe erro reenvia.
 */
@Controller('integracoes/pagamentos/:segredo')
export class WebhookController {
  private readonly log = new Logger('WebhookController');

  @Post(['webhook', 'webhook/pix'])
  @HttpCode(200)
  async webhook(@Req() req: Request, @Headers('content-type') contentType: string | undefined, @Ip() ip: string) {
    const { pool, tenant } = tenantCtx();
    const corpo = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    const { rows } = await pool.query(
      `insert into pagamento_webhooks (origem, content_type, corpo_bruto, ip_origem) values ('itau_pix', $1, $2, $3) returning id`,
      [contentType ?? null, corpo, ip ?? null],
    );
    this.log.log(`webhook gravado (tenant=${tenant.slug}, id=${rows[0].id})`);
    return { recebido: true };
  }
}
```

- [ ] **Step 3: Teste do processador (falha primeiro)**

```ts
// apps/api/src/pagamentos/webhooks.processor.spec.ts
import type { Pool } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';
import { WebhooksProcessor } from './webhooks.processor';

describe('WebhooksProcessor', () => {
  it('casa txid com pagamentos e confirma; marca o webhook processado', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-1', corpo_bruto: JSON.stringify({ ref: 'PED000001X', valor: 10 }) }] }) // pendentes
      .mockResolvedValueOnce({ rows: [{ id: 'pag-1', expira_em: new Date() }] })                                    // busca por provedor_ref
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const pagamentos = new PagamentosService();
    const confirmar = jest.spyOn(pagamentos, 'confirmarPago').mockResolvedValue(true);
    const proc = new WebhooksProcessor(pagamentos);
    await proc.processar({ query } as unknown as Pool, new MockProvedor());
    expect(query.mock.calls[1][1]).toEqual(['mock', 'PED000001X']);
    expect(confirmar).toHaveBeenCalledWith(expect.anything(), 'pag-1', 10, expect.any(Date));
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1]).toEqual(['wh-1']);
  });

  it('webhook sem ref conhecida vira erro no registro, não explode', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-2', corpo_bruto: JSON.stringify({ ref: 'NAOEXISTE', valor: 1 }) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const proc = new WebhooksProcessor(new PagamentosService());
    await proc.processar({ query } as unknown as Pool, new MockProvedor());
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1][0]).toBe('wh-2');
    expect(marca![1][1]).toContain('NAOEXISTE');
  });
});
```

- [ ] **Step 4: Implementar o processador**

```ts
// apps/api/src/pagamentos/webhooks.processor.ts
import { Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { PagamentosService } from './pagamentos.service';
import { ProvedorPagamento } from './provedor-pagamento';

/** Lê pagamento_webhooks não processados do tenant e aplica as confirmações. */
@Injectable()
export class WebhooksProcessor {
  private readonly log = new Logger('WebhooksProcessor');

  constructor(private readonly pagamentos: PagamentosService) {}

  async processar(pool: Pool, provedor: ProvedorPagamento): Promise<void> {
    const { rows } = await pool.query(
      `select id, corpo_bruto from pagamento_webhooks where processado = false order by recebido_em limit 20`,
    );
    for (const wh of rows) {
      const erros: string[] = [];
      try {
        const recebidos = provedor.tratarWebhook(wh.corpo_bruto);
        if (recebidos.length === 0) erros.push('corpo sem confirmações reconhecidas');
        for (const r of recebidos) {
          const pag = await pool.query(
            `select id, expira_em from pagamentos where provedor = $1 and provedor_ref = $2`,
            [provedor.nome, r.ref],
          );
          if (!pag.rows[0]) { erros.push(`ref ${r.ref} não encontrada`); continue; }
          await this.pagamentos.confirmarPago(pool, pag.rows[0].id, r.valorPago, r.pagoEm);
        }
      } catch (e) {
        erros.push(String(e).slice(0, 300));
      }
      await pool.query(`update pagamento_webhooks set processado = true, erro = $2 where id = $1`, [wh.id, erros.length ? erros.join('; ') : null]);
      if (erros.length) this.log.warn(`webhook ${wh.id}: ${erros.join('; ')}`);
    }
  }
}
```

- [ ] **Step 5: Ligar no módulo e excluir do TenancyMiddleware**

`pagamentos.module.ts` completo:

```ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { PagamentosService } from './pagamentos.service';
import { ProvedoresService } from './provedores.service';
import { WebhookAuthMiddleware } from './webhook-auth.middleware';
import { WebhookController } from './webhook.controller';
import { WebhooksProcessor } from './webhooks.processor';

@Module({
  controllers: [WebhookController],
  providers: [PagamentosService, ProvedoresService, WebhooksProcessor],
  exports: [PagamentosService, ProvedoresService, WebhooksProcessor],
})
export class PagamentosModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(WebhookAuthMiddleware).forRoutes(WebhookController);
  }
}
```

Em `app.module.ts`, o `.exclude(...)` do `TenancyMiddleware` vira:

```ts
      .exclude('integracoes/dlinks/(.*)', 'integracoes/maxipago/(.*)', 'integracoes/pagamentos/(.*)')
```

- [ ] **Step 6: Rodar, build, commit**

```bash
npm test -- webhooks.processor && npm run build
git add apps/api/src/pagamentos apps/api/src/app.module.ts
git commit -m "Webhook de pagamento com segredo na URL e processador da fila"
```

---

### Task 7: Worker de consulta (rede de segurança) e aviso de certificado

**Files:**
- Create: `apps/api/src/pagamentos/pagamentos.worker.ts`
- Modify: `apps/api/src/pagamentos/pagamentos.module.ts` (provider)

**Interfaces:**
- Consumes: `ProvedoresService.obter`, `PagamentosService.aplicarSituacao`, `WebhooksProcessor.processar`.

- [ ] **Step 1: Implementar o worker (mesmo padrão do OutboxWorker)**

```ts
// apps/api/src/pagamentos/pagamentos.worker.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PagamentosService } from './pagamentos.service';
import { ProvedoresService } from './provedores.service';
import { WebhooksProcessor } from './webhooks.processor';

/**
 * A cada 30 s, por tenant com provedor: processa webhooks pendentes e consulta
 * no provedor os pagamentos ainda 'pendente' (mais antigos primeiro, 50 por vez).
 * Cobre webhook perdido e expira o que venceu. PAGAMENTOS_DESLIGADO=true desliga.
 */
@Injectable()
export class PagamentosWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PagamentosWorker');
  private timer?: NodeJS.Timeout;
  private rodando = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly provedores: ProvedoresService,
    private readonly pagamentos: PagamentosService,
    private readonly webhooks: WebhooksProcessor,
  ) {}

  onModuleInit() {
    if (process.env.PAGAMENTOS_DESLIGADO === 'true') return;
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      for (const slug of await this.db.listActiveTenantSlugs()) {
        const pt = await this.provedores.obter(slug);
        if (!pt) continue;
        const pool = await this.db.getTenantPool(slug);
        await this.webhooks.processar(pool, pt.provedor);
        const { rows } = await pool.query(
          `select id, provedor_ref, expira_em from pagamentos
            where status = 'pendente' and provedor = $1 order by criado_em limit 50`,
          [pt.provedor.nome],
        );
        for (const p of rows) {
          const ini = Date.now();
          try {
            const s = await pt.provedor.consultar(p.provedor_ref);
            await this.pagamentos.aplicarSituacao(pool, p, s);
            await pool.query(
              `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
               values ('itau_pix_consulta','fluxo_para_erp',$1,$2,true,$3)`,
              [p.provedor_ref, s.status, Date.now() - ini],
            );
          } catch (e) {
            this.log.warn(`consulta ${slug}/${p.provedor_ref}: ${e}`);
            await pool.query(
              `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
               values ('itau_pix_consulta','fluxo_para_erp',$1,$2,false,$3)`,
              [p.provedor_ref, String(e).slice(0, 500), Date.now() - ini],
            );
          }
        }
      }
    } catch (e) {
      this.log.error(e);
    } finally {
      this.rodando = false;
    }
  }
}
```

- [ ] **Step 2: Registrar no módulo**

Em `pagamentos.module.ts`, adicionar `PagamentosWorker` em `providers` (e o import).

- [ ] **Step 3: Teste manual com o provedor mock**

No banco de controle de dev:

```sql
insert into pagamento_provedores (tenant_id, provedor, config_json)
select id, 'mock', '{"expiracaoSegundos": 120, "webhookSegredoHash": "<sha256 de "segredo-dev">"}'::jsonb from tenants where slug = 'cahu';
```
(`node -e "console.log(require('crypto').createHash('sha256').update('segredo-dev').digest('hex'))"`.)

Subir a API (`npm run start:dev`), criar um pedido PIX pelo app/curl, conferir `select status from pedidos order by criado_em desc limit 1` = `AGUARDANDO_PAGAMENTO`, então:

```bash
curl -s -X POST http://localhost:3000/v1/integracoes/pagamentos/segredo-dev/webhook -H "Content-Type: application/json" -d '{"ref":"<provedor_ref do pagamento>","valor":10}'
```
Em até 30 s o pedido vira `RECEBIDO` com evento "PIX pago". Deixar outro pedido vencer os 120 s: vira `CANCELADO` com "PIX expirado".

- [ ] **Step 4: Build e commit**

```bash
npm run build && git add apps/api/src/pagamentos
git commit -m "Worker de consulta de pagamentos pendentes"
```

---

### Task 8: Endpoints admin e retaguarda

**Files:**
- Modify: `apps/api/src/admin/admin.controller.ts` (após `pedidos/:id/reenviar-erp`, ~L92)
- Modify: `apps/api/src/admin/admin.service.ts:85-100` (query `pedido`)
- Modify: `apps/api/src/admin/admin.module.ts` (importar PagamentosModule)
- Modify: `apps/admin/src/api.ts:88-99`
- Modify: `apps/admin/src/paginas/Pedidos.tsx:39`
- Modify: `apps/admin/src/paginas/PedidoDetalhe.tsx`
- Modify: `apps/admin/src/index.css` (ou onde estão as classes `.badge.RECEBIDO`)

- [ ] **Step 1: API admin — detalhe com pagamento e ações**

Na query de `AdminService.pedido`, acrescentar depois da subquery `nota`:

```ts
        (select row_to_json(g) from pagamentos g where g.pedido_id = p.id order by g.criado_em desc limit 1) as pagamento,
        (select coalesce(max((v->>'total')::numeric), null) from (
            select valores_json as v from pedido_faturamentos f where f.pedido_id = p.id) x) as total_faturado
```
Se a tabela de faturamento da migração 018 tiver outro nome/coluna, usar a existente (`grep -n "create table" infra/sql/tenant/018_dlinks_pedido_faturamento.sql`); o objetivo é o valor faturado pelo Dlinks pra retaguarda calcular "valor a devolver" = `valor_pago - total_faturado` quando positivo.

Em `AdminService`, novos métodos:

```ts
  async consultarPagamento(pedidoId: string) {
    const { pool, tenant } = tenantCtx();
    const pt = await this.provedores.obter(tenant.slug);
    if (!pt) throw new BadRequestException('Tenant sem provedor de pagamento');
    const { rows } = await pool.query(
      `select id, provedor_ref, expira_em, status from pagamentos where pedido_id = $1 order by criado_em desc limit 1`, [pedidoId]);
    if (!rows[0]) throw new NotFoundException('Pedido sem pagamento online');
    if (rows[0].status !== 'pendente') return { status: rows[0].status };
    const s = await pt.provedor.consultar(rows[0].provedor_ref);
    await this.pagamentos.aplicarSituacao(pool, rows[0], s);
    const depois = await pool.query(`select status from pagamentos where id = $1`, [rows[0].id]);
    return { status: depois.rows[0].status };
  }

  /** Só com provedor mock (dev). */
  async simularPagamento(pedidoId: string) {
    const { pool, tenant } = tenantCtx();
    const pt = await this.provedores.obter(tenant.slug);
    if (!pt || pt.provedor.nome !== 'mock') throw new BadRequestException('Só disponível com provedor mock');
    const { rows } = await pool.query(`select id, valor from pagamentos where pedido_id = $1 and status = 'pendente'`, [pedidoId]);
    if (!rows[0]) throw new NotFoundException('Sem pagamento pendente');
    await this.pagamentos.confirmarPago(pool, rows[0].id, Number(rows[0].valor), new Date());
    return { status: 'pago' };
  }
```
Injetar `ProvedoresService` e `PagamentosService` no construtor do `AdminService` e adicionar `PagamentosModule` em `imports` do `admin.module.ts`.

No `AdminController`:

```ts
  @Post('pedidos/:id/pagamento/consultar')
  consultarPagamento(@Param('id') id: string) {
    return this.admin.consultarPagamento(id);
  }

  @Post('pedidos/:id/pagamento/simular-pago')
  simularPagamento(@Param('id') id: string) {
    return this.admin.simularPagamento(id);
  }
```

- [ ] **Step 2: Retaguarda — labels e filtro**

`apps/admin/src/api.ts`: adicionar `AGUARDANDO_PAGAMENTO: 'Aguardando pagamento',` como primeira entrada de `STATUS_LABEL`.

`apps/admin/src/paginas/Pedidos.tsx` linha 39: a lista de pills vira
```ts
['', 'AGUARDANDO_PAGAMENTO', 'RECEBIDO', 'ENVIADO_ERP', 'ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO', 'FALHA_INTEGRACAO']
```

CSS: onde existem `.badge.RECEBIDO` etc., acrescentar
```css
.badge.AGUARDANDO_PAGAMENTO { background: #fff3cd; color: #7a5b00; }
```

- [ ] **Step 3: Retaguarda — card de pagamento no detalhe**

Em `PedidoDetalhe.tsx`, na interface do pedido acrescentar:

```ts
  pagamento?: {
    id: string; provedor: string; metodo: string; status: string; valor: string; valor_pago?: string | null;
    provedor_ref?: string | null; expira_em?: string | null; pago_em?: string | null; criado_em: string;
  } | null;
  total_faturado?: string | null;
```

E um card logo abaixo do badge de status (antes da lista de itens):

```tsx
{p.pagamento && (
  <section className="card">
    <h3>Pagamento online</h3>
    <dl className="grid-2">
      <dt>Método</dt><dd>{p.pagamento.metodo === 'pix' ? 'PIX' : 'Cartão'} · {p.pagamento.provedor === 'itau_pix' ? 'Itaú' : p.pagamento.provedor}</dd>
      <dt>Status</dt><dd><span className={`badge pag-${p.pagamento.status}`}>{PAGAMENTO_STATUS_LABEL[p.pagamento.status] ?? p.pagamento.status}</span></dd>
      <dt>Valor cobrado</dt><dd>{fmtMoeda(Number(p.pagamento.valor))}</dd>
      {p.pagamento.valor_pago && <><dt>Valor pago</dt><dd>{fmtMoeda(Number(p.pagamento.valor_pago))}</dd></>}
      {p.pagamento.provedor_ref && <><dt>txid</dt><dd><code>{p.pagamento.provedor_ref}</code></dd></>}
      <dt>Criado</dt><dd>{fmtData(p.pagamento.criado_em)}</dd>
      {p.pagamento.expira_em && <><dt>Expira</dt><dd>{fmtData(p.pagamento.expira_em)}</dd></>}
      {p.pagamento.pago_em && <><dt>Pago em</dt><dd>{fmtData(p.pagamento.pago_em)}</dd></>}
      {p.pagamento.valor_pago && p.total_faturado && Number(p.pagamento.valor_pago) > Number(p.total_faturado) && (
        <><dt>A devolver</dt><dd className="alerta">{fmtMoeda(Number(p.pagamento.valor_pago) - Number(p.total_faturado))} (faturado menor que o pago)</dd></>
      )}
    </dl>
    {p.pagamento.status === 'pendente' && (
      <button className="btn" onClick={consultarPagamento} disabled={consultando}>
        {consultando ? 'Consultando…' : 'Consultar no Itaú'}
      </button>
    )}
  </section>
)}
```

Com, no topo do componente:

```tsx
const PAGAMENTO_STATUS_LABEL: Record<string, string> = {
  pendente: 'Aguardando', pago: 'Pago', expirado: 'Expirado', cancelado: 'Cancelado', falhou: 'Falhou',
};
const [consultando, setConsultando] = useState(false);
async function consultarPagamento() {
  setConsultando(true);
  try {
    await api.post(`/admin/pedidos/${p.id}/pagamento/consultar`, {});
    await carregar(); // função que já recarrega o pedido na página
  } finally {
    setConsultando(false);
  }
}
```
(Se a função de recarga tiver outro nome no arquivo, usar o nome real. Se `api.post` não existir em `api.ts`, seguir o helper que `reenviar-erp` usa.)

CSS: `.badge.pag-pendente { background:#fff3cd; color:#7a5b00 } .badge.pag-pago { background:#d1e7dd; color:#0f5132 } .badge.pag-expirado, .badge.pag-cancelado, .badge.pag-falhou { background:#f8d7da; color:#842029 }`.

- [ ] **Step 4: Build dos dois apps e commit**

```bash
(cd apps/api && npm run build) && (cd apps/admin && npm run build)
git add apps/api/src/admin apps/admin/src
git commit -m "Retaguarda: status Aguardando pagamento, card de pagamento e consulta no Itau"
```

---

### Task 9: App Flutter — tela do PIX, checkout, detalhe e lista

**Files:**
- Modify: `apps/mobile/pubspec.yaml:38` (adicionar `qr_flutter: ^4.1.0`)
- Create: `apps/mobile/lib/features/checkout/pagamento_pix_screen.dart`
- Create: `apps/mobile/lib/widgets/bloco_pix.dart`
- Modify: `apps/mobile/lib/features/checkout/checkout_screen.dart:27-31,136-146`
- Modify: `apps/mobile/lib/features/orders/pedido_detalhe_screen.dart:119-165`
- Modify: `apps/mobile/lib/features/orders/status_pedido.dart`

- [ ] **Step 1: Dependência**

Em `pubspec.yaml`, abaixo de `http: ^1.6.0`:
```yaml
  qr_flutter: ^4.1.0
```
```bash
cd apps/mobile && C:/dev/flutter/bin/flutter pub get
```

- [ ] **Step 2: Widget reutilizável do PIX**

```dart
// apps/mobile/lib/widgets/bloco_pix.dart
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';

import '../core/formatadores.dart';

/// QR + copia-e-cola + contador. Usado na tela pós-checkout e no detalhe do pedido.
/// [pagamento] é o objeto `pagamento` que a API devolve em /pedidos.
class BlocoPix extends StatefulWidget {
  const BlocoPix({super.key, required this.pagamento});
  final Map<String, dynamic> pagamento;

  @override
  State<BlocoPix> createState() => _BlocoPixState();
}

class _BlocoPixState extends State<BlocoPix> {
  Timer? _timer;
  Duration _restante = Duration.zero;

  DateTime? get _expiraEm {
    final v = widget.pagamento['expiraEm'];
    return v == null ? null : DateTime.tryParse('$v')?.toLocal();
  }

  @override
  void initState() {
    super.initState();
    _atualizar();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _atualizar());
  }

  void _atualizar() {
    final e = _expiraEm;
    if (e == null) return;
    final r = e.difference(DateTime.now());
    if (mounted) setState(() => _restante = r.isNegative ? Duration.zero : r);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _copiar(String codigo) async {
    await Clipboard.setData(ClipboardData(text: codigo));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Código PIX copiado!')));
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pagamento;
    final status = '${p['status']}';
    final codigo = p['copiaCola'] as String?;
    final cor = Theme.of(context).colorScheme.primary;

    if (status == 'pago') {
      return _cartao(Icons.check_circle, Colors.green.shade600, 'PIX pago',
          p['pagoEm'] != null ? 'Confirmado em ${dataHora(p['pagoEm'])}' : 'Pagamento confirmado');
    }
    if (status != 'pendente' || codigo == null) {
      return _cartao(Icons.timer_off, Colors.red.shade600, 'PIX expirado',
          'O prazo de pagamento acabou e o pedido foi cancelado. Você pode repetir o pedido.');
    }
    final mm = _restante.inMinutes.remainder(60).toString().padLeft(2, '0');
    final ss = _restante.inSeconds.remainder(60).toString().padLeft(2, '0');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Text('Pague ${moeda(p['valor'])} com PIX',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 4),
            Text(_restante == Duration.zero ? 'Prazo encerrado' : 'Expira em $mm:$ss',
                style: TextStyle(color: cor, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            QrImageView(data: codigo, size: 220, backgroundColor: Colors.white),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () => _copiar(codigo),
              icon: const Icon(Icons.copy),
              label: const Text('Copiar código PIX'),
            ),
            const SizedBox(height: 8),
            Text('Abra o app do seu banco, escolha PIX copia e cola e cole o código. '
                'Assim que pagar, o pedido segue automaticamente.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 13, color: Colors.grey.shade700, height: 1.4)),
          ],
        ),
      ),
    );
  }

  Widget _cartao(IconData icone, Color cor, String titulo, String texto) {
    return Card(
      child: ListTile(
        leading: Icon(icone, color: cor, size: 32),
        title: Text(titulo, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(texto),
      ),
    );
  }
}
```
Se `formatadores.dart` não tiver `dataHora`, criar lá: `String dataHora(dynamic v) { final d = DateTime.tryParse('$v')?.toLocal(); return d == null ? '' : '${d.day.toString().padLeft(2,'0')}/${d.month.toString().padLeft(2,'0')} ${d.hour.toString().padLeft(2,'0')}:${d.minute.toString().padLeft(2,'0')}'; }`.

- [ ] **Step 3: Tela pós-checkout com polling**

```dart
// apps/mobile/lib/features/checkout/pagamento_pix_screen.dart
import 'dart:async';

import 'package:flutter/material.dart';

import '../../core/api_client.dart';
import '../../widgets/bloco_pix.dart';
import '../orders/pedido_detalhe_screen.dart';

/// Depois do "Confirmar pedido" com PIX online: mostra o QR e consulta o pedido
/// a cada 5 s até sair de AGUARDANDO_PAGAMENTO.
class PagamentoPixScreen extends StatefulWidget {
  const PagamentoPixScreen({super.key, required this.pedido});
  final Map<String, dynamic> pedido; // resposta do POST /pedidos (com 'pagamento')

  @override
  State<PagamentoPixScreen> createState() => _PagamentoPixScreenState();
}

class _PagamentoPixScreenState extends State<PagamentoPixScreen> {
  late Map<String, dynamic> _pedido = widget.pedido;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _consultar());
  }

  Future<void> _consultar() async {
    try {
      final r = await ApiClient.instance.get('/pedidos/${_pedido['id']}') as Map<String, dynamic>;
      if (!mounted) return;
      setState(() => _pedido = r);
      if (r['status'] != 'AGUARDANDO_PAGAMENTO') {
        _poll?.cancel();
        final pago = r['status'] != 'CANCELADO';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(pago ? 'Pagamento confirmado! Pedido enviado.' : 'PIX expirado, pedido cancelado.')));
        Navigator.of(context).pushReplacement(MaterialPageRoute(
            builder: (_) => PedidoDetalheScreen(pedidoId: r['id'] as String)));
      }
    } catch (_) {
      // Sem rede: mantém QR e contador; a próxima rodada tenta de novo.
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pagamento = (_pedido['pagamento'] as Map<String, dynamic>?) ?? {};
    return Scaffold(
      appBar: AppBar(title: Text('Pedido nº ${_pedido['numero']}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          BlocoPix(pagamento: pagamento),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(
                builder: (_) => PedidoDetalheScreen(pedidoId: _pedido['id'] as String))),
            child: const Text('Pagar depois (ver pedido)'),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Checkout**

Em `checkout_screen.dart`, a entrada `pix` de `_formasConhecidas` vira:

```dart
  _FormaPagamento('pix', Icons.qr_code_2, 'PIX',
      'Pague na hora pelo QR Code ou copia e cola',
      'O código PIX aparece assim que você confirmar. O pedido segue para a distribuidora '
      'depois do pagamento (você tem 30 minutos).'),
```

No `_confirmar`, a navegação vira:

```dart
      CarrinhoStore.instance.limpar();
      if (!mounted) return;
      final pagamento = pedido['pagamento'] as Map<String, dynamic>?;
      Navigator.of(context).pushReplacement(MaterialPageRoute(
          builder: (_) => pagamento != null && pagamento['status'] == 'pendente'
              ? PagamentoPixScreen(pedido: pedido)
              : PedidoSucessoScreen(pedido: pedido)));
```
com `import 'pagamento_pix_screen.dart';`.

- [ ] **Step 5: Detalhe e lista**

Em `pedido_detalhe_screen.dart`, perto de `final cobranca = p['cobranca'] ...` (L119):
```dart
    final pagamento = p['pagamento'] as Map<String, dynamic>?;
```
e na lista de widgets (L160), antes de `if (cobranca != null) _cartaoCobranca(cobranca),`:
```dart
            if (pagamento != null) BlocoPix(pagamento: pagamento),
```
com `import '../../widgets/bloco_pix.dart';`. Se o pedido estiver em AGUARDANDO_PAGAMENTO, o detalhe também deve consultar a cada 5 s: reaproveitar o mesmo `Timer.periodic` da tela do PIX chamando o método de carga que a tela já tem (`_carregar()` ou equivalente), cancelando quando o status mudar.

Em `status_pedido.dart` (ChipStatus), acrescentar o caso:
```dart
      case 'AGUARDANDO_PAGAMENTO':
        return ('Aguardando pagamento', Colors.amber.shade700);
```
seguindo o formato que o arquivo usa pros outros status.

- [ ] **Step 6: Analisar, rodar no emulador com provedor mock e commitar**

```bash
C:/dev/flutter/bin/flutter analyze
```
Expected: `No issues found!`. Rodar o app apontando pra API local com o tenant em `mock` (Task 7 passo 3): fechar um pedido PIX, ver o QR, disparar `simular-pago` na retaguarda, ver a tela mudar sozinha.

```bash
git add apps/mobile
git commit -m "App: tela de pagamento PIX com QR, contador e confirmacao automatica"
```

---

### Task 10: Setup de produção (credencial, webhook, migrações) e deploy

**Files:**
- Create: `infra/scripts/itau-pix-provedor.sql`
- Create: `infra/scripts/itau-pix-registrar-webhook.js`
- Create: `apps/api/.env.example` (se não existir) com `PAGAMENTOS_DESLIGADO=`

- [ ] **Step 1: SQL de provisionamento do provedor**

```sql
-- infra/scripts/itau-pix-provedor.sql  (banco de CONTROLE)
-- Uso: psql -v slug=cahu -v hash=<sha256 do segredo do webhook> -f infra/scripts/itau-pix-provedor.sql
-- O segredo em texto puro só vive na URL cadastrada no Itaú. Gerar:
--   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
--   node -e "console.log(require('crypto').createHash('sha256').update('<segredo>').digest('hex'))"
insert into pagamento_provedores (tenant_id, provedor, config_json)
select t.id, 'itau_pix', jsonb_build_object(
  'chavePix', '61920643000148',
  'nomeRecebedor', 'CAHU DISTRIBUIDORA',
  'cidade', 'RECIFE',
  'expiracaoSegundos', 1800,
  'credencialArquivo', 'C:\itau-cahu-pix\credencial.json',
  'webhookSegredoHash', :'hash')
  from tenants t where t.slug = :'slug'
on conflict (tenant_id, provedor) do update set config_json = excluded.config_json, ativo = true;
```

- [ ] **Step 2: Script de registro do webhook (roda no .254)**

```js
// infra/scripts/itau-pix-registrar-webhook.js
// Uso no .254: node infra/scripts/itau-pix-registrar-webhook.js C:\itau-cahu-pix\credencial.json https://cahudelivery.duckdns.org/v1/integracoes/pagamentos/<segredo>/webhook
// Registra a URL no Itaú (PUT /webhook/{chave}). O Itaú chama <url>/pix nas confirmações.
const fs = require('node:fs');
const path = require('node:path');
const { ItauPixProvedor } = require(path.join(__dirname, '..', '..', 'apps', 'api', 'dist', 'pagamentos', 'itau-pix.provedor.js'));

const [credArq, url] = process.argv.slice(2);
if (!credArq || !url) { console.error('uso: credencial.json url'); process.exit(1); }
const cred = JSON.parse(fs.readFileSync(credArq, 'utf8'));
const prov = new ItauPixProvedor({
  chavePix: '61920643000148', nomeRecebedor: 'CAHU DISTRIBUIDORA', cidade: 'RECIFE',
  clientId: cred.clientId, clientSecret: cred.clientSecret, pfx: fs.readFileSync(cred.pfxArquivo), pfxSenha: cred.pfxSenha,
});
prov.registrarWebhook(url).then((r) => {
  console.log('status', r.status);
  console.log(r.texto.slice(0, 500));
});
```

- [ ] **Step 3: Credencial no servidor (via SSH, sem passar segredo pelo chat)**

No `.254`, criar `C:\itau-cahu-pix\credencial.json` a partir de `ClientID_e_Secret.txt` com um script PowerShell que lê o txt e grava o JSON:

```powershell
$t = Get-Content C:\itau-cahu-pix\ClientID_e_Secret.txt -Raw
$secret = [regex]::Match($t, 'Secret:\s*(\S+)').Groups[1].Value
$cid = [regex]::Match($t, 'Client_ID:\s*(\S+)').Groups[1].Value
@{ clientId = $cid; clientSecret = $secret; pfxArquivo = 'C:\itau-cahu-pix\certificado.pfx'; pfxSenha = '<senha do pfx — fora do repo>' } | ConvertTo-Json | Set-Content -Encoding utf8 C:\itau-cahu-pix\credencial.json
```
A conta que roda a API precisa de leitura nessa pasta.

- [ ] **Step 4: Ordem de deploy no .254**

1. `git pull` na pasta do app; `npm install` (novas deps só no mobile, mas o `dist` precisa do build novo); build de `apps/api` e `apps/admin`.
2. Migrações por scp + `psql -w -f` (role `claude_migra`): `030_pagamentos.sql` precisa rodar em TODAS as bases de tenant do `.254`, não só CAHU — `orders.service.ts` (listar/detalhe de pedidos) faz subselect em `pagamentos` sem condicional nenhuma, então qualquer tenant que ficar sem a 030 quebra a API assim que o build novo sobe, mesmo sem nunca ter usado PIX online. Aplicar a 030 em todo tenant ANTES do restart-api.flag do passo 4. `004_pagamento_provedores.sql` roda uma vez, no banco de controle.
3. Gerar segredo do webhook + hash; rodar `itau-pix-provedor.sql` no controle.
4. `restart-api.flag` — só depois de confirmar que a 030 já está aplicada em todo tenant (passo 2). Conferir que `PAGAMENTOS_DESLIGADO` no `.env` do `.254`, se setado, está como `PAGAMENTOS_DESLIGADO=true` (o código compara com a string `'true'`; `=1` não desliga o worker).
5. `node infra/scripts/itau-pix-registrar-webhook.js ...` e conferir `status 200/201`.
6. Teste real: pedido de R$ 0,01 no app pelo Tiago (o provedor cobra `valor` do pedido, então criar um produto de teste de R$ 0,01 ou usar saldo de carteira pra abater até sobrar R$ 0,01). Conferir: QR aparece, pagamento cai, pedido vira RECEBIDO em segundos, Dlinks lista o pedido com `pagamentoOnline`.
7. Gerar APK (`flutter build apk --release`, comando registrado na memória "CAHU sempre usar URL pública") e distribuir.

- [ ] **Step 5: Commit**

```bash
git add infra/scripts/itau-pix-provedor.sql infra/scripts/itau-pix-registrar-webhook.js
git commit -m "Scripts de provisionamento do provedor Itau PIX e registro do webhook"
git push origin main
```

---

## Self-review

**Cobertura da spec:** fluxo/status (T1, T3, T5), tabelas (T1), provedor Itaú + mock (T2, T4), webhook + processador (T6), worker (T7), API admin + retaguarda (T8), app (T9), Dlinks (T5), setup/deploy (T10), erros (rollback no checkout T5; token renovado T4; idempotência T3; webhook perdido T7). Aviso de certificado vencendo em 30 dias: não implementado neste plano; a data está na memória e no spec (25/09/2027), fica como lembrete manual.

**Placeholders:** nenhum "TBD". Pontos deixados explicitamente pra confirmar no primeiro teste real: URL base da API PIX (`baseUrl` configurável em `config_json`) e se a resposta do `PUT /cob` traz `pixCopiaECola` (fallback pelo `location` já coberto e testado).

**Consistência de nomes:** `ProvedorPagamento.nome/metodo`, `PagamentosService.criarParaPedido/confirmarPago/expirar/aplicarSituacao/gerarRef`, `ProvedoresService.obter/slugPorSegredoHash`, `WebhooksProcessor.processar(pool, provedor)`, campo `pagamento` no JSON do pedido com chaves `id, metodo, status, valor, copiaCola, expiraEm, pagoEm` (usadas igual no app), `pagamentoOnline` no Dlinks. Rota do webhook `integracoes/pagamentos/:segredo/webhook[/pix]` igual no middleware, controller, exclude e script.
