# Mapa de Clientes e Pedidos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela **Mapa** na retaguarda do CAHU Delivery mostrando clientes e pedidos sobre um mapa, com coordenadas geocodificadas de graça (BrasilAPI + Nominatim) por um job noturno.

**Architecture:** Migração adiciona lat/lng em `cliente_enderecos`. Um worker na API (mesmo padrão `setInterval` do `OutboxWorker`) geocodifica endereços pendentes às 03:00 ou sob demanda. Endpoint `GET /admin/mapa` devolve clientes e pedidos já com coordenada. Tela React usa Leaflet + OpenStreetMap + markercluster.

**Tech Stack:** NestJS 11 (API, jest + ts-jest), PostgreSQL 16 (um banco por tenant), React 19 + Vite + TypeScript (retaguarda), `leaflet`, `leaflet.markercluster`. Node 24 (fetch global).

Spec: `docs/superpowers/specs/2026-09-16-mapa-clientes-pedidos-design.md`

## Global Constraints

- Nunca escrever no ERP (Dlinks). Nada muda no sync.
- Tela nunca chama serviço externo; só a API (job) chama BrasilAPI/Nominatim.
- Ritmo do job: **1 requisição por segundo**, timeout 8 s, máximo **5 tentativas** por endereço.
- Nominatim exige header `User-Agent: FluxoCommerce/1.0 (contato@fluxocerto.com.br)`.
- Botões de ação ficam **acima** do mapa, nunca em rodapé.
- Cores: acento amarelo CAHU `#FFD500` (`var(--acento)` na retaguarda), cliente cinza `#6b7280`.
- Textos de UI em português do Brasil, sem inglês.
- Commits em português, terminando com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Raiz do repo: `C:\Users\tiago\OneDrive\Documentos\CAHU DELIVERY\fluxo-commerce`. Caminhos abaixo são relativos a ela.
- Banco dev local: `PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu`.
- Produção: migração é aplicada **pelo Tiago** com psql (a conta SSH não tem senha do banco). Deploy da API: `git pull` + `npm run build` em `C:\cahudelivery\apps\api` e `type nul > C:\cahudelivery\restart-api.flag`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `infra/sql/tenant/023_geocodificacao_enderecos.sql` | Colunas de coordenada e controle de tentativas |
| `apps/api/src/geo/geocodificador.ts` | Função pura: endereço → coordenada via BrasilAPI e Nominatim (fetch injetável) |
| `apps/api/src/geo/geocodificador.spec.ts` | Testes do resolvedor com fetch mockado |
| `apps/api/src/geo/geocodificacao.worker.ts` | Agenda 03:00 + execução sob demanda, varre tenants, grava no banco, expõe estado |
| `apps/api/src/geo/geo.module.ts` | Módulo que exporta o worker |
| `apps/api/src/admin/mapa.service.ts` | Consulta clientes/pedidos com coordenada e contadores |
| `apps/api/src/admin/mapa-filtros.ts` + `.spec.ts` | Parse dos filtros `de/ate/status` (puro, testável) |
| `apps/api/src/admin/admin.controller.ts` | Rotas `GET /admin/mapa` e `POST /admin/mapa/geocodificar` |
| `apps/api/src/admin/admin.module.ts` | Importa `GeoModule`, registra `MapaService` |
| `apps/api/src/app.module.ts` | Importa `GeoModule` |
| `apps/admin/src/paginas/Mapa.tsx` | Tela do mapa |
| `apps/admin/src/App.tsx`, `Layout.tsx` | Rota e item de menu |
| `apps/admin/src/paginas/Clientes.tsx` | Lê `busca` da URL como valor inicial |
| `apps/admin/src/index.css` | Estilos do mapa/balão |

---

### Task 1: Migração 023

**Files:**
- Create: `infra/sql/tenant/023_geocodificacao_enderecos.sql`

**Interfaces:**
- Produces: colunas `latitude`, `longitude` (double precision), `geo_precisao` ('cep'|'endereco'), `geocodificado_em`, `geo_tentativas` (int, default 0), `geo_ultima_tentativa_em` em `cliente_enderecos`.

- [ ] **Step 1: Criar o arquivo**

```sql
-- 023: geocodificação de endereços (Mapa da retaguarda)
alter table cliente_enderecos
  add column if not exists latitude                double precision,
  add column if not exists longitude               double precision,
  add column if not exists geo_precisao            text check (geo_precisao in ('cep','endereco')),
  add column if not exists geocodificado_em        timestamptz,
  add column if not exists geo_tentativas          int not null default 0,
  add column if not exists geo_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_geo_pendente_idx
  on cliente_enderecos (geo_tentativas) where latitude is null;
```

- [ ] **Step 2: Aplicar no banco dev**

```bash
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f "C:/Users/tiago/OneDrive/Documentos/CAHU DELIVERY/fluxo-commerce/infra/sql/tenant/023_geocodificacao_enderecos.sql"
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -c "\d cliente_enderecos" | grep -E "latitude|geo_"
```

Expected: `ALTER TABLE`, `CREATE INDEX`, e as 6 colunas listadas.

- [ ] **Step 3: Commit**

```bash
git add infra/sql/tenant/023_geocodificacao_enderecos.sql
git commit -m "feat(db): migração 023 — coordenadas em cliente_enderecos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Resolvedor de coordenadas (função pura)

**Files:**
- Create: `apps/api/src/geo/geocodificador.ts`
- Test: `apps/api/src/geo/geocodificador.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EnderecoGeo { cep: string; logradouro: string; numero: string; cidade: string; uf: string }
  export interface Coordenada { lat: number; lng: number; precisao: 'cep' | 'endereco' }
  export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
  export async function geocodificar(end: EnderecoGeo, fetchFn?: FetchFn): Promise<Coordenada | null>
  ```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/geo/geocodificador.spec.ts
import { geocodificar, EnderecoGeo } from './geocodificador';

const end: EnderecoGeo = { cep: '56302-000', logradouro: 'Av. Sete de Setembro', numero: '100', cidade: 'Petrolina', uf: 'PE' };

function resposta(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('geocodificar', () => {
  it('resolve pelo CEP na BrasilAPI com precisão cep', async () => {
    const fetchFn = jest.fn(async () =>
      resposta(200, { location: { coordinates: { latitude: '-9.39', longitude: '-40.50' } } }),
    );
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -9.39, lng: -40.5, precisao: 'cep' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://brasilapi.com.br/api/cep/v2/56302000');
  });

  it('cai para o Nominatim quando a BrasilAPI vem sem coordenada', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(200, { location: { coordinates: {} } }))
      .mockResolvedValueOnce(resposta(200, [{ lat: '-9.3891', lon: '-40.5027' }]));
    const c = await geocodificar(end, fetchFn);
    expect(c).toEqual({ lat: -9.3891, lng: -40.5027, precisao: 'endereco' });
    const url = String(fetchFn.mock.calls[1][0]);
    expect(url.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
    expect(url).toContain('street=100+Av.+Sete+de+Setembro');
    expect(url).toContain('city=Petrolina');
    expect(url).toContain('state=PE');
    expect(url).toContain('countrycodes=br');
    const init = fetchFn.mock.calls[1][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe('FluxoCommerce/1.0 (contato@fluxocerto.com.br)');
  });

  it('devolve null quando nenhuma fonte resolve', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(resposta(404, { message: 'CEP não encontrado' }))
      .mockResolvedValueOnce(resposta(200, []));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    expect(await geocodificar(end, fetchFn)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd apps/api && npx jest src/geo/geocodificador.spec.ts
```
Expected: FAIL — `Cannot find module './geocodificador'`.

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/geo/geocodificador.ts
/**
 * Endereço → coordenada, sem chave e sem custo.
 * 1) BrasilAPI pelo CEP (precisão de rua/bairro).
 * 2) Nominatim (OpenStreetMap) pelo endereço completo.
 * Nunca lança: erro de rede ou resposta vazia devolve null.
 */
export interface EnderecoGeo {
  cep: string;
  logradouro: string;
  numero: string;
  cidade: string;
  uf: string;
}

export interface Coordenada {
  lat: number;
  lng: number;
  precisao: 'cep' | 'endereco';
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const USER_AGENT = 'FluxoCommerce/1.0 (contato@fluxocerto.com.br)';
const TIMEOUT_MS = 8_000;

export async function geocodificar(end: EnderecoGeo, fetchFn: FetchFn = fetch): Promise<Coordenada | null> {
  const porCep = await viaBrasilApi(end, fetchFn);
  if (porCep) return porCep;
  return viaNominatim(end, fetchFn);
}

async function viaBrasilApi(end: EnderecoGeo, fetchFn: FetchFn): Promise<Coordenada | null> {
  const cep = end.cep.replace(/\D/g, '');
  if (cep.length !== 8) return null;
  try {
    const res = await fetchFn(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { location?: { coordinates?: { latitude?: string; longitude?: string } } };
    const c = body.location?.coordinates;
    const lat = Number(c?.latitude);
    const lng = Number(c?.longitude);
    if (!c?.latitude || !c?.longitude || Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, precisao: 'cep' };
  } catch {
    return null;
  }
}

async function viaNominatim(end: EnderecoGeo, fetchFn: FetchFn): Promise<Coordenada | null> {
  const q = new URLSearchParams({
    format: 'json',
    limit: '1',
    countrycodes: 'br',
    street: `${end.numero} ${end.logradouro}`.trim(),
    city: end.cidade,
    state: end.uf,
  });
  try {
    const res = await fetchFn(`https://nominatim.openstreetmap.org/search?${q}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = body[0];
    if (!hit) return null;
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng, precisao: 'endereco' };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd apps/api && npx jest src/geo/geocodificador.spec.ts
```
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/geo/geocodificador.ts apps/api/src/geo/geocodificador.spec.ts
git commit -m "feat(api): resolvedor de coordenadas via BrasilAPI e Nominatim

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Worker de geocodificação + GeoModule

**Files:**
- Create: `apps/api/src/geo/geocodificacao.worker.ts`
- Create: `apps/api/src/geo/geo.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/geo/geocodificacao.worker.spec.ts`

**Interfaces:**
- Consumes: `geocodificar(end, fetchFn)` da Task 2; `DatabaseService.listActiveTenantSlugs()`, `getTenantPool(slug)`.
- Produces:
  ```ts
  export class GeocodificacaoWorker {
    estado(): { emAndamento: boolean; ultimaExecucaoEm: string | null }
    dispararAgora(): { iniciado: boolean; emAndamento: boolean }   // não bloqueia
    processarPendentes(): Promise<void>                          // usada pelo agendador e pelo disparo manual
  }
  export function deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean  // puro
  ```

- [ ] **Step 1: Escrever o teste da regra de agenda (puro) e do processamento com pool mockado**

```ts
// apps/api/src/geo/geocodificacao.worker.spec.ts
import { deveRodarAgora, GeocodificacaoWorker } from './geocodificacao.worker';

describe('deveRodarAgora', () => {
  it('roda às 03:xx se ainda não rodou hoje', () => {
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 0, 30), null)).toBe(true);
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 59, 0), '2026-09-15')).toBe(true);
  });
  it('não roda fora das 03:xx nem duas vezes no mesmo dia', () => {
    expect(deveRodarAgora(new Date(2026, 8, 16, 2, 59, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 16, 4, 0, 0), null)).toBe(false);
    expect(deveRodarAgora(new Date(2026, 8, 16, 3, 10, 0), '2026-09-16')).toBe(false);
  });
});

describe('GeocodificacaoWorker.processarPendentes', () => {
  function montar(rows: unknown[], coord: unknown) {
    const query = jest.fn(async (sql: string) => (sql.includes('select') ? { rows } : { rows: [] }));
    const db = {
      listActiveTenantSlugs: async () => ['cahu'],
      getTenantPool: async () => ({ query }),
    };
    const geocodificar = jest.fn(async () => coord);
    const w = new GeocodificacaoWorker(db as never, { geocodificar, esperar: async () => undefined });
    return { w, query, geocodificar };
  }

  const linha = { id: 'e1', cep: '56302000', logradouro: 'Rua A', numero: '1', cidade: 'Petrolina', uf: 'PE' };

  it('grava lat/lng quando resolve', async () => {
    const { w, query } = montar([linha], { lat: -9.39, lng: -40.5, precisao: 'cep' });
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('set latitude'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual([-9.39, -40.5, 'cep', 'e1']);
    expect(w.estado().emAndamento).toBe(false);
    expect(w.estado().ultimaExecucaoEm).not.toBeNull();
  });

  it('incrementa tentativas quando não resolve', async () => {
    const { w, query } = montar([linha], null);
    await w.processarPendentes();
    const update = query.mock.calls.find(([sql]) => String(sql).includes('geo_tentativas = geo_tentativas + 1'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['e1']);
  });

  it('dispararAgora não inicia duas execuções ao mesmo tempo', async () => {
    const { w } = montar([linha], null);
    const r1 = w.dispararAgora();
    const r2 = w.dispararAgora();
    expect(r1).toEqual({ iniciado: true, emAndamento: true });
    expect(r2).toEqual({ iniciado: false, emAndamento: true });
    await new Promise((r) => setTimeout(r, 10));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd apps/api && npx jest src/geo/geocodificacao.worker.spec.ts
```
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar worker e módulo**

```ts
// apps/api/src/geo/geocodificacao.worker.ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Coordenada, EnderecoGeo, geocodificar as geocodificarPadrao } from './geocodificador';

const MAX_TENTATIVAS = 5;
const LOTE = 200;
const HORA_AGENDADA = 3; // 03:00 hora local do servidor
const INTERVALO_MS = 1_000; // 1 req/s (Nominatim)

/** Regra pura da agenda: roda uma vez por dia, dentro da hora 03:xx. */
export function deveRodarAgora(agora: Date, ultimaDataRodada: string | null): boolean {
  if (agora.getHours() !== HORA_AGENDADA) return false;
  return dataLocal(agora) !== ultimaDataRodada;
}

function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Deps {
  geocodificar: (end: EnderecoGeo) => Promise<Coordenada | null>;
  esperar: (ms: number) => Promise<void>;
}

const depsPadrao: Deps = {
  geocodificar: (end) => geocodificarPadrao(end),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Geocodifica endereços de cliente sem coordenada (todos os tenants).
 * Mesmo padrão do OutboxWorker: setInterval dentro da API, sem fila externa.
 * Nunca escreve no ERP; só em cliente_enderecos.
 */
@Injectable()
export class GeocodificacaoWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('GeocodificacaoWorker');
  private timer: NodeJS.Timeout | null = null;
  private emAndamento = false;
  private ultimaExecucaoEm: Date | null = null;
  private ultimaDataRodada: string | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly deps: Deps = depsPadrao,
  ) {}

  onModuleInit() {
    if (process.env.GEOCODIFICACAO_DESLIGADA === 'true') return;
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

  /** Dispara em background; se já estiver rodando, não inicia outra. */
  dispararAgora(): { iniciado: boolean; emAndamento: boolean } {
    if (this.emAndamento) return { iniciado: false, emAndamento: true };
    void this.processarPendentes().catch((e) => this.log.error(e));
    return { iniciado: true, emAndamento: true };
  }

  async processarPendentes(): Promise<void> {
    if (this.emAndamento) return;
    this.emAndamento = true;
    const contagem = { processados: 0, porCep: 0, porEndereco: 0, falhas: 0 };
    try {
      for (const slug of await this.db.listActiveTenantSlugs()) {
        const pool = await this.db.getTenantPool(slug);
        const { rows } = await pool.query(
          `select id, cep, logradouro, numero, cidade, uf from cliente_enderecos
            where latitude is null and geo_tentativas < $1
            order by geo_ultima_tentativa_em nulls first limit $2`,
          [MAX_TENTATIVAS, LOTE],
        );
        for (const end of rows as (EnderecoGeo & { id: string })[]) {
          const coord = await this.deps.geocodificar(end);
          contagem.processados++;
          if (coord) {
            await pool.query(
              `update cliente_enderecos
                  set latitude = $1, longitude = $2, geo_precisao = $3,
                      geocodificado_em = now(), geo_ultima_tentativa_em = now()
                where id = $4`,
              [coord.lat, coord.lng, coord.precisao, end.id],
            );
            if (coord.precisao === 'cep') contagem.porCep++;
            else contagem.porEndereco++;
          } else {
            await pool.query(
              `update cliente_enderecos
                  set geo_tentativas = geo_tentativas + 1, geo_ultima_tentativa_em = now()
                where id = $1`,
              [end.id],
            );
            contagem.falhas++;
          }
          await this.deps.esperar(INTERVALO_MS);
        }
      }
      this.log.log(
        `geocodificação: ${contagem.processados} processados, ${contagem.porCep} por CEP, ${contagem.porEndereco} por endereço, ${contagem.falhas} falhas`,
      );
    } finally {
      this.emAndamento = false;
      this.ultimaExecucaoEm = new Date();
    }
  }
}
```

```ts
// apps/api/src/geo/geo.module.ts
import { Module } from '@nestjs/common';
import { GeocodificacaoWorker } from './geocodificacao.worker';

@Module({
  providers: [GeocodificacaoWorker],
  exports: [GeocodificacaoWorker],
})
export class GeoModule {}
```

Em `apps/api/src/app.module.ts`, adicionar o import e o módulo na lista:

```ts
import { GeoModule } from './geo/geo.module';
// ...
imports: [DatabaseModule, IntegrationModule, AuthModule, CatalogModule, OrdersModule, ProfileModule, AdminModule, DlinksModule, GeoModule],
```

Observação: o Nest injeta só `DatabaseService`; o segundo parâmetro `deps` usa o default. Para o Nest não tentar resolver `Deps`, marcar o parâmetro com `@Optional()`:

```ts
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
// ...
  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly deps: Deps = depsPadrao,
  ) {}
```

- [ ] **Step 4: Rodar testes e build**

```bash
cd apps/api && npx jest src/geo && npm run build
```
Expected: `6 passed` (2 arquivos), build sem erro.

- [ ] **Step 5: Rodar a API em dev e disparar uma passada real no banco dev**

```bash
cd apps/api && npm run start:dev
```
Em outro terminal, forçar uma execução via node (a rota admin só chega na Task 4), então nesta task validar apenas que a API sobe sem erro e loga `Nest application successfully started`. A passada real fica para o smoke da Task 4.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/geo apps/api/src/app.module.ts
git commit -m "feat(api): worker de geocodificação noturna (03:00) com disparo manual

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Endpoint `GET /admin/mapa` e `POST /admin/mapa/geocodificar`

**Files:**
- Create: `apps/api/src/admin/mapa-filtros.ts`
- Test: `apps/api/src/admin/mapa-filtros.spec.ts`
- Create: `apps/api/src/admin/mapa.service.ts`
- Modify: `apps/api/src/admin/admin.controller.ts` (adicionar duas rotas)
- Modify: `apps/api/src/admin/admin.module.ts` (import GeoModule, provider MapaService)

**Interfaces:**
- Consumes: `GeocodificacaoWorker.estado()` e `dispararAgora()` (Task 3); `tenantCtx().pool`.
- Produces:
  ```ts
  export interface FiltrosMapa { de: string; ate: string; status: string[] }   // datas YYYY-MM-DD
  export function parseFiltrosMapa(q: { de?: string; ate?: string; status?: string }, hoje?: Date): FiltrosMapa
  export class MapaService { mapa(f: FiltrosMapa): Promise<RespostaMapa> }
  ```
  Resposta JSON (contrato usado pela tela):
  ```ts
  interface RespostaMapa {
    clientes: { id: string; nome: string; documento: string; cidade: string; bairro: string; endereco: string; lat: number; lng: number; precisao: 'cep' | 'endereco' }[];
    pedidos:  { id: string; numero: number; clienteId: string; cliente: string; status: string; total: number; criadoEm: string; endereco: string; lat: number; lng: number; precisao: 'cep' | 'endereco' }[];
    semLocalizacao: { clientes: number; pedidos: number };
    geocodificacao: { emAndamento: boolean; ultimaExecucaoEm: string | null };
  }
  ```

- [ ] **Step 1: Teste do parse de filtros**

```ts
// apps/api/src/admin/mapa-filtros.spec.ts
import { parseFiltrosMapa, STATUS_PADRAO } from './mapa-filtros';

const hoje = new Date(2026, 8, 16, 10, 0, 0);

describe('parseFiltrosMapa', () => {
  it('padrão: últimos 7 dias e todos os status exceto CANCELADO', () => {
    expect(parseFiltrosMapa({}, hoje)).toEqual({ de: '2026-09-09', ate: '2026-09-16', status: STATUS_PADRAO });
  });
  it('aceita de/ate e lista de status válidos', () => {
    expect(parseFiltrosMapa({ de: '2026-09-01', ate: '2026-09-10', status: 'RECEBIDO,ENTREGUE' }, hoje)).toEqual({
      de: '2026-09-01', ate: '2026-09-10', status: ['RECEBIDO', 'ENTREGUE'],
    });
  });
  it('ignora status desconhecido e datas inválidas', () => {
    const f = parseFiltrosMapa({ de: 'ontem', status: 'XPTO,FATURADO' }, hoje);
    expect(f.de).toBe('2026-09-09');
    expect(f.status).toEqual(['FATURADO']);
  });
  it('lista só com desconhecidos vira o padrão', () => {
    expect(parseFiltrosMapa({ status: 'XPTO' }, hoje).status).toEqual(STATUS_PADRAO);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd apps/api && npx jest src/admin/mapa-filtros.spec.ts
```
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar filtros e serviço**

```ts
// apps/api/src/admin/mapa-filtros.ts
export const STATUS_VALIDOS = [
  'RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO', 'CANCELADO',
] as const;
export const STATUS_PADRAO = STATUS_VALIDOS.filter((s) => s !== 'CANCELADO') as string[];

export interface FiltrosMapa {
  de: string;   // YYYY-MM-DD
  ate: string;  // YYYY-MM-DD
  status: string[];
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseFiltrosMapa(q: { de?: string; ate?: string; status?: string }, hoje = new Date()): FiltrosMapa {
  const seteDiasAtras = new Date(hoje);
  seteDiasAtras.setDate(hoje.getDate() - 7);
  const de = q.de && DATA_RE.test(q.de) ? q.de : iso(seteDiasAtras);
  const ate = q.ate && DATA_RE.test(q.ate) ? q.ate : iso(hoje);
  const pedidos = (q.status ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is (typeof STATUS_VALIDOS)[number] => (STATUS_VALIDOS as readonly string[]).includes(s));
  return { de, ate, status: pedidos.length ? pedidos : STATUS_PADRAO };
}
```

```ts
// apps/api/src/admin/mapa.service.ts
import { Injectable } from '@nestjs/common';
import { GeocodificacaoWorker } from '../geo/geocodificacao.worker';
import { tenantCtx } from '../tenancy/tenant-context';
import { FiltrosMapa } from './mapa-filtros';

/** Dados da tela Mapa: só leitura do banco do tenant; nunca chama serviço externo. */
@Injectable()
export class MapaService {
  constructor(private readonly geo: GeocodificacaoWorker) {}

  async mapa(f: FiltrosMapa) {
    const { pool } = tenantCtx();
    const [clientes, pedidos, semLoc] = await Promise.all([
      pool.query(
        `select distinct on (c.id)
                c.id, c.nome_fantasia as nome, c.documento, e.cidade, e.bairro,
                concat_ws(', ', e.logradouro, e.numero) as endereco,
                e.latitude as lat, e.longitude as lng, e.geo_precisao as precisao
           from clientes c
           join cliente_enderecos e on e.cliente_id = c.id and e.latitude is not null
          where c.status <> 'bloqueado'
          order by c.id, e.padrao desc`,
      ),
      pool.query(
        `select p.id, p.numero, p.cliente_id as "clienteId", c.nome_fantasia as cliente, p.status,
                p.total::float as total, p.criado_em as "criadoEm",
                concat_ws(', ', e.logradouro, e.numero) || ' - ' || e.bairro || ', ' || e.cidade as endereco,
                e.latitude as lat, e.longitude as lng, e.geo_precisao as precisao
           from pedidos p
           join clientes c on c.id = p.cliente_id
           left join lateral (
             select e1.* from cliente_enderecos e1
              where e1.cliente_id = p.cliente_id and e1.latitude is not null
              order by (e1.id::text = p.endereco_snapshot_json->>'id') desc, e1.padrao desc
              limit 1
           ) e on true
          where p.criado_em::date between $1 and $2
            and p.status = any($3)
            and e.id is not null
          order by p.criado_em desc`,
        [f.de, f.ate, f.status],
      ),
      pool.query(
        `select
           (select count(*)::int from clientes c
             where c.status <> 'bloqueado'
               and not exists (select 1 from cliente_enderecos e where e.cliente_id = c.id and e.latitude is not null)) as clientes,
           (select count(*)::int from pedidos p
             where p.criado_em::date between $1 and $2 and p.status = any($3)
               and not exists (select 1 from cliente_enderecos e where e.cliente_id = p.cliente_id and e.latitude is not null)) as pedidos`,
        [f.de, f.ate, f.status],
      ),
    ]);
    return {
      clientes: clientes.rows,
      pedidos: pedidos.rows,
      semLocalizacao: semLoc.rows[0],
      geocodificacao: this.geo.estado(),
    };
  }

  geocodificarAgora() {
    return this.geo.dispararAgora();
  }
}
```

Em `apps/api/src/admin/admin.controller.ts`:

```ts
// imports novos
import { MapaService } from './mapa.service';
import { parseFiltrosMapa } from './mapa-filtros';

// construtor
constructor(private readonly admin: AdminService, private readonly mapa: MapaService) {}

// rotas novas (colocar logo após pedido/:id)
@Get('mapa')
mapaDados(@Query('de') de?: string, @Query('ate') ate?: string, @Query('status') status?: string) {
  return this.mapa.mapa(parseFiltrosMapa({ de, ate, status }));
}

@Post('mapa/geocodificar')
@HttpCode(200)
mapaGeocodificar() {
  return this.mapa.geocodificarAgora();
}
```

Em `apps/api/src/admin/admin.module.ts`:

```ts
import { GeoModule } from '../geo/geo.module';
import { MapaService } from './mapa.service';
// ...
@Module({
  imports: [GeoModule],
  controllers: [ /* inalterado */ ],
  providers: [AdminService, AdminGuard, MapaService],
})
```

- [ ] **Step 4: Rodar testes e build**

```bash
cd apps/api && npx jest src/admin/mapa-filtros.spec.ts && npm run build
```
Expected: `4 passed`; build OK.

- [ ] **Step 5: Smoke real no banco dev**

Subir a API (`npm run start:dev`), fazer login admin e chamar:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/v1/admin/auth/login -H 'X-Tenant: cahu' -H 'Content-Type: application/json' -d '{"email":"admin@cahu.com.br","senha":"admin123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s -X POST http://localhost:3000/v1/admin/mapa/geocodificar -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN"
```
Expected: `{"iniciado":true,"emAndamento":true}`. Aguardar ~N segundos (1 por endereço) e:

```bash
curl -s "http://localhost:3000/v1/admin/mapa" -H "X-Tenant: cahu" -H "Authorization: Bearer $TOKEN" | node -pe 'const r=JSON.parse(require("fs").readFileSync(0)); [r.clientes.length, r.pedidos.length, r.semLocalizacao, r.geocodificacao]'
PGPASSWORD=postgres psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -c "select cep, latitude, longitude, geo_precisao, geo_tentativas from cliente_enderecos order by geocodificado_em desc nulls last limit 10"
```
Expected: clientes com coordenada > 0, `emAndamento: false`, tabela com lat/lng preenchidos. Se o e-mail/senha do admin dev forem outros, usar os do `infra/scripts/seed-dev.sql`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/admin/mapa-filtros.ts apps/api/src/admin/mapa-filtros.spec.ts apps/api/src/admin/mapa.service.ts apps/api/src/admin/admin.controller.ts apps/api/src/admin/admin.module.ts
git commit -m "feat(api): GET /admin/mapa e POST /admin/mapa/geocodificar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Tela Mapa na retaguarda

**Files:**
- Modify: `apps/admin/package.json` (deps via npm install)
- Create: `apps/admin/src/paginas/Mapa.tsx`
- Modify: `apps/admin/src/App.tsx` (rota), `apps/admin/src/Layout.tsx` (menu)
- Modify: `apps/admin/src/paginas/Clientes.tsx` (busca inicial da URL)
- Modify: `apps/admin/src/index.css` (estilos)

**Interfaces:**
- Consumes: `GET /admin/mapa?de&ate&status` e `POST /admin/mapa/geocodificar` (Task 4, contrato `RespostaMapa`); helpers `api`, `fmtMoeda`, `fmtData`, `fmtDocumento`, `STATUS_LABEL` de `apps/admin/src/api.ts`.

- [ ] **Step 1: Instalar dependências**

```bash
cd apps/admin && npm install leaflet leaflet.markercluster && npm install -D @types/leaflet @types/leaflet.markercluster
```
Expected: `package.json` com `leaflet` e `leaflet.markercluster` em dependencies.

- [ ] **Step 2: Menu e rota**

`apps/admin/src/Layout.tsx` — inserir após a linha de Pedidos:

```ts
  { para: '/mapa', rotulo: '🗺️ Mapa' },
```

`apps/admin/src/App.tsx` — import e rota após `/pedidos/:id`:

```ts
import { Mapa } from './paginas/Mapa';
// ...
  ['/mapa', <Mapa />],
```

- [ ] **Step 3: Clientes lê `busca` da URL**

Em `apps/admin/src/paginas/Clientes.tsx`, trocar:

```ts
  const [busca, setBusca] = useState('');
```
por:
```ts
  const [busca, setBusca] = useState(params.get('busca') ?? '');
```

- [ ] **Step 4: Escrever a página**

```tsx
// apps/admin/src/paginas/Mapa.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { api, fmtData, fmtDocumento, fmtMoeda, STATUS_LABEL } from '../api';

interface ClienteMapa {
  id: string; nome: string; documento: string; cidade: string; bairro: string; endereco: string;
  lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface PedidoMapa {
  id: string; numero: number; clienteId: string; cliente: string; status: string; total: number; criadoEm: string;
  endereco: string; lat: number; lng: number; precisao: 'cep' | 'endereco';
}
interface RespostaMapa {
  clientes: ClienteMapa[];
  pedidos: PedidoMapa[];
  semLocalizacao: { clientes: number; pedidos: number };
  geocodificacao: { emAndamento: boolean; ultimaExecucaoEm: string | null };
}

type Modo = 'ambos' | 'clientes' | 'pedidos';
type Periodo = 'hoje' | '7' | '30';

const STATUS_FILTRO = ['RECEBIDO', 'ENVIADO_ERP', 'FATURADO', 'EM_SEPARACAO', 'SAIU_ENTREGA', 'ENTREGUE', 'FALHA_INTEGRACAO'];
const COR_BORDA: Record<string, string> = {
  RECEBIDO: '#1a1a1a', ENVIADO_ERP: '#1a1a1a', FATURADO: '#1d4ed8', EM_SEPARACAO: '#1d4ed8',
  SAIU_ENTREGA: '#b45309', ENTREGUE: '#14803c', FALHA_INTEGRACAO: '#c02626', CANCELADO: '#65707e',
};
const CENTRO_PADRAO: [number, number] = [-9.39, -40.5]; // Petrolina

function isoDia(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function intervalo(periodo: Periodo): { de: string; ate: string } {
  const hoje = new Date();
  const de = new Date(hoje);
  if (periodo === '7') de.setDate(hoje.getDate() - 7);
  if (periodo === '30') de.setDate(hoje.getDate() - 30);
  return { de: isoDia(de), ate: isoDia(hoje) };
}
function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export function Mapa() {
  const [params, setParams] = useSearchParams();
  const modo = (params.get('modo') as Modo) || 'ambos';
  const periodo = (params.get('periodo') as Periodo) || '7';
  const statusSel = useMemo(() => (params.get('status') ?? '').split(',').filter(Boolean), [params]);

  const [dados, setDados] = useState<RespostaMapa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [disparando, setDisparando] = useState(false);

  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.MarkerClusterGroup | null>(null);
  const divRef = useRef<HTMLDivElement | null>(null);

  const atualizarParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? p.set(k, v) : p.delete(k));
    setParams(p);
  };

  const carregar = useCallback(() => {
    const { de, ate } = intervalo(periodo);
    const q = new URLSearchParams({ de, ate });
    if (statusSel.length) q.set('status', statusSel.join(','));
    setErro(null);
    api<RespostaMapa>(`/admin/mapa?${q}`).then(setDados).catch((e) => setErro(e.message));
  }, [periodo, statusSel]);

  useEffect(carregar, [carregar]);

  // Enquanto geocodifica, consulta a cada 10 s até terminar.
  useEffect(() => {
    if (!dados?.geocodificacao.emAndamento) return;
    const t = setInterval(carregar, 10_000);
    return () => clearInterval(t);
  }, [dados?.geocodificacao.emAndamento, carregar]);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = L.map(divRef.current).setView(CENTRO_PADRAO, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(mapa);
    const camada = L.markerClusterGroup({ maxClusterRadius: 40 });
    mapa.addLayer(camada);
    mapaRef.current = mapa;
    camadaRef.current = camada;
    return () => {
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Redesenha os pontos quando dados/modo mudam.
  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada || !dados) return;
    camada.clearLayers();
    const pontos: L.LatLngExpression[] = [];

    if (modo !== 'pedidos') {
      for (const c of dados.clientes) {
        const m = L.circleMarker([c.lat, c.lng], { radius: 7, color: '#4b5563', weight: 1, fillColor: '#6b7280', fillOpacity: 0.85 });
        m.bindPopup(
          `<div class="popup-mapa">
             <strong>${esc(c.nome)}</strong><br>
             <span class="mono">${esc(fmtDocumento(c.documento))}</span><br>
             ${esc(c.endereco)} - ${esc(c.bairro)}, ${esc(c.cidade)}<br>
             ${c.precisao === 'cep' ? '<small>Localização aproximada pelo CEP</small><br>' : ''}
             <a href="/clientes?busca=${encodeURIComponent(c.documento)}">Abrir cliente</a>
           </div>`,
        );
        camada.addLayer(m);
        pontos.push([c.lat, c.lng]);
      }
    }
    if (modo !== 'clientes') {
      for (const p of dados.pedidos) {
        const m = L.circleMarker([p.lat, p.lng], { radius: 9, color: COR_BORDA[p.status] ?? '#1a1a1a', weight: 2.5, fillColor: '#FFD500', fillOpacity: 0.95 });
        m.bindPopup(
          `<div class="popup-mapa">
             <strong>Pedido #${p.numero}</strong> <span class="badge ${esc(p.status)}">${esc(STATUS_LABEL[p.status] ?? p.status)}</span><br>
             ${esc(p.cliente)}<br>
             ${esc(fmtMoeda(p.total))} · ${esc(fmtData(p.criadoEm))}<br>
             ${esc(p.endereco)}<br>
             ${p.precisao === 'cep' ? '<small>Localização aproximada pelo CEP</small><br>' : ''}
             <a href="/pedidos/${p.id}">Abrir pedido</a>
           </div>`,
        );
        camada.addLayer(m);
        pontos.push([p.lat, p.lng]);
      }
    }
    if (pontos.length) mapa.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 15 });
    else mapa.setView(CENTRO_PADRAO, 12);
  }, [dados, modo]);

  const geocodificar = async () => {
    setDisparando(true);
    try {
      await api('/admin/mapa/geocodificar', { method: 'POST' });
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setDisparando(false);
    }
  };

  const alternarStatus = (s: string) => {
    const novo = statusSel.includes(s) ? statusSel.filter((x) => x !== s) : [...statusSel, s];
    atualizarParams({ status: novo.join(',') });
  };

  const emAndamento = dados?.geocodificacao.emAndamento ?? false;
  const semLoc = dados?.semLocalizacao;

  return (
    <>
      <h1>Mapa</h1>
      <div className="filtros" style={{ alignItems: 'center' }}>
        {(['ambos', 'clientes', 'pedidos'] as Modo[]).map((m) => (
          <button key={m} className={`pill-filtro ${modo === m ? 'ativo' : ''}`} onClick={() => atualizarParams({ modo: m === 'ambos' ? '' : m })}>
            {m === 'ambos' ? 'Ambos' : m === 'clientes' ? 'Clientes' : 'Pedidos'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {semLoc && (
          <span className="mapa-aviso">
            {semLoc.clientes} cliente{semLoc.clientes === 1 ? '' : 's'} / {semLoc.pedidos} pedido{semLoc.pedidos === 1 ? '' : 's'} sem localização
          </span>
        )}
        <button className="btn btn-claro" onClick={geocodificar} disabled={emAndamento || disparando}>
          {emAndamento ? 'Geocodificando…' : 'Geocodificar pendentes'}
        </button>
      </div>
      {modo !== 'clientes' && (
        <div className="filtros">
          <button className={`pill-filtro ${!statusSel.length ? 'ativo' : ''}`} onClick={() => atualizarParams({ status: '' })}>Todos</button>
          {STATUS_FILTRO.map((s) => (
            <button key={s} className={`pill-filtro ${statusSel.includes(s) ? 'ativo' : ''}`} onClick={() => alternarStatus(s)}>
              {STATUS_LABEL[s]}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {(['hoje', '7', '30'] as Periodo[]).map((p) => (
            <button key={p} className={`pill-filtro ${periodo === p ? 'ativo' : ''}`} onClick={() => atualizarParams({ periodo: p === '7' ? '' : p })}>
              {p === 'hoje' ? 'Hoje' : `${p} dias`}
            </button>
          ))}
        </div>
      )}
      {erro && (
        <div className="erro-texto">
          {erro} <button className="btn btn-mini btn-claro" onClick={carregar}>Tentar de novo</button>
        </div>
      )}
      <div className="mapa-legenda">
        <span><i className="mapa-ponto cliente" /> Cliente</span>
        <span><i className="mapa-ponto pedido" /> Pedido (borda = status)</span>
        {!dados && !erro && <span className="vazio">Carregando…</span>}
      </div>
      <div ref={divRef} className="mapa-wrap" />
    </>
  );
}
```

- [ ] **Step 5: Estilos**

Adicionar ao fim de `apps/admin/src/index.css`:

```css
/* Mapa */
.mapa-wrap { height: calc(100vh - 230px); min-height: 520px; border: 1px solid var(--borda); border-radius: var(--raio); box-shadow: var(--sombra); overflow: hidden; }
.mapa-aviso { color: var(--texto-2); font-size: 13px; }
.mapa-legenda { display: flex; gap: 18px; align-items: center; margin: 0 0 10px; font-size: 13px; color: var(--texto-2); }
.mapa-ponto { display: inline-block; width: 12px; height: 12px; border-radius: 50%; vertical-align: -2px; margin-right: 4px; }
.mapa-ponto.cliente { background: #6b7280; border: 1px solid #4b5563; }
.mapa-ponto.pedido { background: #FFD500; border: 2px solid #1a1a1a; }
.popup-mapa { font: 13px/1.45 inherit; min-width: 200px; }
.popup-mapa small { color: var(--texto-2); }
.popup-mapa a { display: inline-block; margin-top: 6px; font-weight: 700; color: #1a1a1a; }
.leaflet-container { font-family: inherit; }
```

- [ ] **Step 6: Build, lint e conferir no navegador**

```bash
cd apps/admin && npm run lint && npm run build
```
Expected: sem erros de tipo (se `L.markerClusterGroup` não tipar, confirmar que `@types/leaflet.markercluster` está instalado e o `import 'leaflet.markercluster'` vem depois do `import L from 'leaflet'`).

Rodar `npm run dev` com a API dev no ar, abrir `http://localhost:5173/mapa` e conferir:
1. Item "🗺️ Mapa" no menu abaixo de Pedidos.
2. Pontos cinza (clientes) e amarelos (pedidos) aparecem; mapa enquadra os pontos.
3. Clicar num pedido: balão com nº, status, total, data e link "Abrir pedido" que abre `/pedidos/:id`.
4. Clicar num cliente: link "Abrir cliente" abre a tela Clientes já filtrada pelo documento.
5. Alternar Clientes / Pedidos / Ambos e os filtros de status e período mudam a URL e os pontos.
6. "Geocodificar pendentes" fica desabilitado com "Geocodificando…" e volta ao normal quando o job termina.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json apps/admin/package-lock.json apps/admin/src/paginas/Mapa.tsx apps/admin/src/App.tsx apps/admin/src/Layout.tsx apps/admin/src/paginas/Clientes.tsx apps/admin/src/index.css
git commit -m "feat(admin): tela Mapa com clientes e pedidos (Leaflet + OpenStreetMap)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Deploy e verificação em produção

**Files:** nenhum novo.

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Avisar o Tiago para aplicar a migração em produção** (a conta SSH não tem senha do banco):

```
C:\PostgreSQL\16\bin\psql.exe -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f C:\cahudelivery\infra\sql\tenant\023_geocodificacao_enderecos.sql
```

- [ ] **Step 3: Deploy da API e da retaguarda** (via SSH `ssh -i ~/.ssh/claude_254 claude-ssh@100.102.231.28`, só depois da migração aplicada):

```powershell
cd C:\cahudelivery; git pull
cd C:\cahudelivery\apps\api; npm install; npm run build; type nul > C:\cahudelivery\restart-api.flag
cd C:\cahudelivery\apps\admin; npm install; npm run build
```

- [ ] **Step 4: Verificar**

Abrir a retaguarda em produção, entrar em Mapa, clicar em "Geocodificar pendentes", aguardar (1 s por endereço) e confirmar que os clientes reais aparecem no mapa e que o contador "sem localização" cai. Confirmar no log da API a linha `geocodificação: N processados, ...`.

---

## Self-review

- **Cobertura da spec:** schema (T1), job noturno + manual + limite 5 + 1 req/s + logs (T3), endpoint com filtros, contadores e estado (T4), tela com modo/status/período, balões, cluster, botão, polling 10 s, centro padrão Petrolina (T5), Clientes lê busca da URL (T5 passo 3), deploy (T6). Fora de escopo mantido fora.
- **Placeholders:** nenhum; todo passo de código traz o código.
- **Consistência de tipos:** `Coordenada`/`EnderecoGeo` (T2) usados no worker (T3); `estado()`/`dispararAgora()` (T3) usados no `MapaService` (T4); contrato `RespostaMapa` (T4) igual ao da tela (T5), incluindo `clienteId`/`criadoEm` em camelCase via alias no SQL.
