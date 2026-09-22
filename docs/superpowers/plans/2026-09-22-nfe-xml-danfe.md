# NF-e do Dlinks: XML guardado e DANFE gerado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber o bloco `nota_fiscal` que o Dlinks manda no `POST /pedidos-faturados`, guardar o XML, e entregar ao cliente (app) e à equipe (retaguarda) o download do XML e um DANFE em PDF gerado pela nossa API.

**Architecture:** O DTO passa a declarar `nota_fiscal` (hoje o `whitelist: true` o descarta em silêncio) e o service grava em `pedido_notas`, fora do caminho de transição de status para funcionar também em reenvio. Um módulo novo `apps/api/src/notas/` serve os arquivos por URL assinada com HMAC, com o slug do tenant no caminho da URL (o navegador externo não manda `X-Tenant`), e gera o DANFE sob demanda a partir do XML guardado.

**Tech Stack:** NestJS 11, TypeScript, PostgreSQL (node-pg), Jest, `fast-xml-parser`, `pdfkit`, Flutter (app), React (retaguarda).

**Spec:** `docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md`

## Global Constraints

- **A migração é a `029`, não a 028.** A 028 foi tomada por `028_ie_e_municipio.sql` em 22/09/2026. O spec ainda diz 028 — a Task 1 corrige o spec junto.
- **Sem dependência com build nativo.** O .254 é Windows; só `fast-xml-parser` e `pdfkit` (JS puro). Nada de Puppeteer, `canvas`, `sharp` novo ou libs de DANFE prontas (quebram com os campos `IBSCBS` da reforma tributária).
- **Nunca gravar URL quebrada.** Sem `PUBLIC_URL` no ambiente, `xml_url`/`pdf_url` ficam `null` e o service loga erro — nunca uma URL com `undefined`.
- **O ERP é somente leitura.** Nada neste plano escreve no MySQL do ERP.
- **Rotas do módulo `notas` não passam pelo `TenancyMiddleware`** — resolvem o tenant pelo slug no path, como a MaxiPago.
- **Português sem acento em mensagem de commit** (convenção do repo). Código e comentários com acento normal.
- Todo commit termina com: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

## File Structure

**Criar:**
| Arquivo | Responsabilidade |
|---|---|
| `infra/sql/tenant/029_nfe_xml_serie.sql` | colunas `serie` e `xml` em `pedido_notas` |
| `apps/api/src/notas/assinatura.ts` | assina e confere o HMAC das URLs; monta a URL absoluta |
| `apps/api/src/notas/assinatura.spec.ts` | testes da assinatura |
| `apps/api/src/notas/nfe-xml.parser.ts` | XML → `NotaFiscalLida` |
| `apps/api/src/notas/nfe-xml.parser.spec.ts` | testes do parser |
| `apps/api/src/notas/fixtures/nfe-5060.xml` | XML real do pedido 5060 |
| `apps/api/src/notas/codigo-barras.ts` | chave → larguras de barras Code128C |
| `apps/api/src/notas/codigo-barras.spec.ts` | testes do código de barras |
| `apps/api/src/notas/danfe.renderer.ts` | `NotaFiscalLida` → Buffer PDF |
| `apps/api/src/notas/danfe.renderer.spec.ts` | testes do renderer |
| `apps/api/src/notas/notas-tenant.middleware.ts` | resolve tenant pelo slug no path |
| `apps/api/src/notas/notas.service.ts` | busca XML no banco, orquestra parser+renderer |
| `apps/api/src/notas/notas.controller.ts` | valida HMAC, responde arquivo |
| `apps/api/src/notas/notas.module.ts` | wiring |
| `apps/api/src/integracoes-dlinks/nota-fiscal.spec.ts` | testes de recepção e gravação |

**Modificar:**
| Arquivo | Mudança |
|---|---|
| `apps/api/src/integracoes-dlinks/pedido-faturado.dto.ts` | classe `NotaFiscalDto` + campo opcional |
| `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts` | ordem dos guards, gravação da nota, centavos |
| `apps/api/src/app.module.ts` | importar `NotasModule`, excluir `notas/(.*)` do tenancy |
| `apps/api/src/orders/orders.service.ts` | incluir `xml_url` no select de `notas()` |
| `apps/api/package.json` | `fast-xml-parser`, `pdfkit`, `@types/pdfkit` |
| `apps/mobile/lib/features/orders/pedido_detalhe_screen.dart` | botão "Baixar XML" |
| `apps/admin/src/paginas/PedidoDetalhe.tsx` | tipo `nota` + links XML/DANFE |
| `docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md` | 028 → 029 |

---

### Task 1: Migração 029 e correção do spec

**Files:**
- Create: `infra/sql/tenant/029_nfe_xml_serie.sql`
- Modify: `docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md`

**Interfaces:**
- Produces: colunas `pedido_notas.serie` (text) e `pedido_notas.xml` (text), consumidas pelas Tasks 8 e 12.

- [ ] **Step 1: Criar a migração**

```sql
-- =====================================================================
-- Fluxo Commerce — Banco do TENANT
-- Migração 029 — série e XML da NF-e recebida do Dlinks
-- O XML é guardado decodificado (não base64): ocupa ~25% menos, é legível
-- num select na hora de investigar, e o base64 não agrega nada.
-- =====================================================================

alter table pedido_notas add column if not exists serie text;
alter table pedido_notas add column if not exists xml   text;

insert into schema_migrations (versao) values ('029') on conflict do nothing;
```

- [ ] **Step 2: Corrigir o número da migração no spec**

No arquivo `docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md`, trocar o título da seção 4 e o insert:
- `### 4. Banco — migração `028_nfe_xml_serie.sql`` → `### 4. Banco — migração `029_nfe_xml_serie.sql``
- `values ('028')` → `values ('029')`
- `Não existe runner de migração no projeto — a 028 é aplicada à mão` → `a 029 é aplicada à mão`

Acrescentar logo abaixo do bloco SQL:

```markdown
> A 028 ficou com `028_ie_e_municipio.sql` (IE do cliente + código IBGE do município),
> desenvolvida em paralelo em 22/09/2026. Por isso a da NF-e é a 029.
```

- [ ] **Step 3: Conferir que não há duas migrações com o mesmo número**

Run: `ls infra/sql/tenant/ | tail -4`
Expected: `026_...`, `027_maxipago_webhook.sql`, `028_ie_e_municipio.sql`, `029_nfe_xml_serie.sql` — cada número uma vez só.

- [ ] **Step 4: Commit**

```bash
git add infra/sql/tenant/029_nfe_xml_serie.sql docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md
git commit -m "Migracao 029: serie e XML da NF-e em pedido_notas

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Dependências novas

**Files:**
- Modify: `apps/api/package.json`

**Interfaces:**
- Produces: `fast-xml-parser` (Task 3) e `pdfkit` (Task 5) disponíveis.

- [ ] **Step 1: Instalar**

```bash
cd apps/api
npm install fast-xml-parser pdfkit
npm install --save-dev @types/pdfkit
```

- [ ] **Step 2: Confirmar que nenhuma tem build nativo**

Run: `npm ls fast-xml-parser pdfkit`
Expected: as duas resolvidas, sem erro. Se o `npm install` tiver disparado `node-gyp`, **pare** — significa dependência nativa, que é proibida pelas Global Constraints.

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json apps/api/package-lock.json
git commit -m "Adiciona fast-xml-parser e pdfkit para gerar o DANFE

Ambas JS puro, sem build nativo, porque o servidor de producao e Windows.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Assinatura HMAC das URLs

**Files:**
- Create: `apps/api/src/notas/assinatura.ts`
- Test: `apps/api/src/notas/assinatura.spec.ts`

**Interfaces:**
- Produces:
  - `type TipoArquivo = 'xml' | 'pdf'`
  - `assinarNota(slug: string, pedidoId: string, tipo: TipoArquivo): string`
  - `assinaturaConfere(slug: string, pedidoId: string, tipo: TipoArquivo, recebida: string | undefined): boolean`
  - `urlNota(slug: string, pedidoId: string, tipo: TipoArquivo): string | null`
  - Usados pelas Tasks 8 (grava URL) e 9 (valida no controller).

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/notas/assinatura.spec.ts
import { assinarNota, assinaturaConfere, urlNota } from './assinatura';

describe('assinatura das URLs de nota', () => {
  const PEDIDO = '2a2d9a5b-5008-4016-bc23-dd8105434d6e';
  const OUTRO = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org';
  });

  it('e estavel: a mesma entrada gera sempre a mesma assinatura', () => {
    expect(assinarNota('cahu', PEDIDO, 'pdf')).toBe(assinarNota('cahu', PEDIDO, 'pdf'));
  });

  it('separa tipo, pedido e tenant', () => {
    const pdf = assinarNota('cahu', PEDIDO, 'pdf');
    expect(assinarNota('cahu', PEDIDO, 'xml')).not.toBe(pdf);
    expect(assinarNota('cahu', OUTRO, 'pdf')).not.toBe(pdf);
    expect(assinarNota('outro', PEDIDO, 'pdf')).not.toBe(pdf);
  });

  it('aceita a assinatura correta', () => {
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', PEDIDO, 'pdf'))).toBe(true);
  });

  it('recusa assinatura de outro pedido, tipo trocado, vazia ou malformada', () => {
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', OUTRO, 'pdf'))).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', PEDIDO, 'xml'))).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', undefined)).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', '')).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', 'xx')).toBe(false); // tamanho diferente
  });

  it('monta a URL absoluta com o tenant no caminho', () => {
    const url = urlNota('cahu', PEDIDO, 'pdf');
    expect(url).toBe(
      `https://cahudelivery.duckdns.org/v1/notas/cahu/${PEDIDO}/danfe.pdf?t=${assinarNota('cahu', PEDIDO, 'pdf')}`,
    );
    expect(urlNota('cahu', PEDIDO, 'xml')).toContain(`/v1/notas/cahu/${PEDIDO}/nota.xml?t=`);
  });

  it('devolve null quando PUBLIC_URL nao esta configurada', () => {
    delete process.env.PUBLIC_URL;
    expect(urlNota('cahu', PEDIDO, 'pdf')).toBeNull();
  });

  it('tira a barra final de PUBLIC_URL para nao gerar URL com barra dupla', () => {
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org/';
    expect(urlNota('cahu', PEDIDO, 'pdf')).toContain('.org/v1/notas/');
    expect(urlNota('cahu', PEDIDO, 'pdf')).not.toContain('//v1/');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/notas/assinatura.spec.ts`
Expected: FAIL — `Cannot find module './assinatura'`

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/notas/assinatura.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TipoArquivo = 'xml' | 'pdf';

/** Nome do arquivo em cada URL — também é o que o navegador usa ao salvar. */
const ARQUIVO: Record<TipoArquivo, string> = { xml: 'nota.xml', pdf: 'danfe.pdf' };

/**
 * Assina o par (tenant, pedido, tipo). O app abre o PDF no navegador externo
 * (`launchUrl`), que não manda o JWT nem o header X-Tenant — então a própria
 * URL precisa ser a credencial. O slug entra no HMAC para que uma assinatura
 * válida num tenant não valha noutro.
 */
export function assinarNota(slug: string, pedidoId: string, tipo: TipoArquivo): string {
  const segredo = process.env.JWT_SECRET ?? 'dev-secret-trocar-em-producao';
  return createHmac('sha256', segredo).update(`${slug}:${pedidoId}:${tipo}`).digest('hex').slice(0, 32);
}

export function assinaturaConfere(
  slug: string,
  pedidoId: string,
  tipo: TipoArquivo,
  recebida: string | undefined,
): boolean {
  if (!recebida) return false;
  const esperada = assinarNota(slug, pedidoId, tipo);
  // timingSafeEqual exige buffers do mesmo tamanho — comparar antes evita a exceção.
  if (recebida.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}

/**
 * URL absoluta e estável, gravada em pedido_notas no momento do faturamento.
 * Sem PUBLIC_URL devolve null — melhor a nota ficar sem link do que com um
 * link quebrado que o cliente clica e não abre.
 */
export function urlNota(slug: string, pedidoId: string, tipo: TipoArquivo): string | null {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) return null;
  return `${base}/v1/notas/${slug}/${pedidoId}/${ARQUIVO[tipo]}?t=${assinarNota(slug, pedidoId, tipo)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/notas/assinatura.spec.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notas/assinatura.ts apps/api/src/notas/assinatura.spec.ts
git commit -m "Assina as URLs de XML e DANFE com HMAC

O app abre o PDF no navegador externo, que nao leva o JWT nem o X-Tenant,
entao a propria URL precisa ser a credencial.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Parser do XML da NF-e

**Files:**
- Create: `apps/api/src/notas/nfe-xml.parser.ts`, `apps/api/src/notas/fixtures/nfe-5060.xml`
- Test: `apps/api/src/notas/nfe-xml.parser.spec.ts`

**Interfaces:**
- Produces: `lerNfe(xml: string): NotaFiscalLida` e os tipos `NotaFiscalLida`, `ParteNfe`, `EnderecoNfe`, `ItemNfe`, `TotaisNfe` — consumidos pelas Tasks 6 e 9.

- [ ] **Step 1: Criar o fixture**

Salvar em `apps/api/src/notas/fixtures/nfe-5060.xml` o XML real do pedido 5060 (enviado pelo Dlinks em 22/09/2026). O conteúdo está em
`C:\Users\tiago\AppData\Local\Temp\claude\C--Users-tiago\ad57900a-5101-4471-a9c7-f329e7987cac\scratchpad\nfe-5060.xml`.

Se esse arquivo não existir mais, regenerar decodificando o `xml_base64` do payload registrado no spec.

> **O fixture é o XML real com o bloco `<Signature>` removido** (≈5 KB de certificado X509 que não muda nada no parse). O Step 2 inclui um teste específico garantindo que o parser tolera a assinatura quando ela vem — não confie só no fixture para isso.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// apps/api/src/notas/nfe-xml.parser.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe } from './nfe-xml.parser';

const XML = readFileSync(join(__dirname, 'fixtures', 'nfe-5060.xml'), 'utf8');

describe('lerNfe', () => {
  const nota = lerNfe(XML);

  it('lê identificação, tirando o prefixo NFe da chave', () => {
    expect(nota.chave).toBe('26260961920643000148550030000050601000073367');
    expect(nota.chave).toHaveLength(44);
    expect(nota.numero).toBe('5060');
    expect(nota.serie).toBe('3');
    expect(nota.naturezaOperacao).toBe('VENDA');
    expect(nota.protocolo).toBe('126260114685548');
  });

  it('lê o emitente com endereço', () => {
    expect(nota.emitente.documento).toBe('61920643000148');
    expect(nota.emitente.nome).toBe('CAHU DISTRIBUIDORA DE ALIMENTOS LTD');
    expect(nota.emitente.ie).toBe('126480516');
    expect(nota.emitente.endereco.municipio).toBe('RECIFE');
    expect(nota.emitente.endereco.uf).toBe('PE');
    expect(nota.emitente.endereco.cep).toBe('54320080');
  });

  it('lê o destinatário', () => {
    expect(nota.destinatario.documento).toBe('21425302000181');
    expect(nota.destinatario.tipoDocumento).toBe('CNPJ');
    expect(nota.destinatario.endereco.municipio).toBe('JABOATAO DOS GUARARAPES');
  });

  it('lê os itens', () => {
    expect(nota.itens).toHaveLength(1);
    const i = nota.itens[0];
    expect(i.numero).toBe(1);
    expect(i.codigo).toBe('7891008367027');
    expect(i.descricao).toBe('BATON GAROTO CASH 30UN CHOCOLATE AO LEIT');
    expect(i.ncm).toBe('18063210');
    expect(i.cfop).toBe('5102');
    expect(i.unidade).toBe('UN');
    expect(i.quantidade).toBe(6);
    expect(i.valorUnitario).toBe(39);
    expect(i.valorTotal).toBe(234);
    expect(i.aliquotaIcms).toBe(20.5);
    expect(i.valorIcms).toBe(47.97);
  });

  it('lê os totais', () => {
    expect(nota.totais.valorProdutos).toBe(234);
    expect(nota.totais.valorTotal).toBe(234);
    expect(nota.totais.valorIcms).toBe(47.97);
    expect(nota.totais.valorDesconto).toBe(0);
    expect(nota.totais.valorFrete).toBe(0);
  });

  it('não quebra com os campos IBS/CBS da reforma tributária', () => {
    // O XML tem IBSCBS/gIBSCBS/vNFTot (NT 2025). O parser ignora, mas não pode
    // engasgar — foi por isso que as libs prontas de DANFE foram descartadas.
    expect(XML).toContain('IBSCBS');
    expect(nota.totais.valorTotal).toBe(234);
  });

  it('tolera o bloco Signature quando ele vem no XML', () => {
    const comAssinatura = XML.replace(
      '</infNFe>',
      '</infNFe><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
        '<SignedInfo><Reference URI="#NFe26"><DigestValue>abc=</DigestValue></Reference></SignedInfo>' +
        '<SignatureValue>zzz=</SignatureValue></Signature>',
    );
    expect(lerNfe(comAssinatura).chave).toBe(nota.chave);
    expect(lerNfe(comAssinatura).itens).toHaveLength(1);
  });

  it('trata nota com um único item e com vários da mesma forma', () => {
    // fast-xml-parser devolve objeto quando há 1 <det> e array quando há vários.
    const doisItens = XML.replace(
      /<det nItem="1">([\s\S]*?)<\/det>/,
      (m, corpo) => `${m}<det nItem="2">${corpo}</det>`,
    );
    expect(lerNfe(doisItens).itens).toHaveLength(2);
  });

  it('rejeita XML sem infNFe', () => {
    expect(() => lerNfe('<nfeProc><nada/></nfeProc>')).toThrow('XML sem infNFe');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/notas/nfe-xml.parser.spec.ts`
Expected: FAIL — `Cannot find module './nfe-xml.parser'`

- [ ] **Step 4: Implementar**

```ts
// apps/api/src/notas/nfe-xml.parser.ts
import { XMLParser } from 'fast-xml-parser';

export interface EnderecoNfe {
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  codigoMunicipio: string;
  uf: string;
  cep: string;
}

export interface ParteNfe {
  documento: string;
  tipoDocumento: 'CNPJ' | 'CPF';
  nome: string;
  ie: string | null;
  fone: string | null;
  endereco: EnderecoNfe;
}

export interface ItemNfe {
  numero: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cst: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  baseIcms: number;
  valorIcms: number;
  aliquotaIcms: number;
  valorIpi: number;
}

export interface TotaisNfe {
  baseIcms: number;
  valorIcms: number;
  valorProdutos: number;
  valorFrete: number;
  valorSeguro: number;
  valorDesconto: number;
  valorIpi: number;
  valorPis: number;
  valorCofins: number;
  valorOutros: number;
  valorTotal: number;
}

export interface NotaFiscalLida {
  chave: string;
  numero: string;
  serie: string;
  naturezaOperacao: string;
  emissaoEm: Date;
  saidaEm: Date | null;
  protocolo: string | null;
  emitente: ParteNfe;
  destinatario: ParteNfe;
  itens: ItemNfe[];
  totais: TotaisNfe;
  modalidadeFrete: string;
  informacoesAdicionais: string | null;
}

// Tudo como texto: valores monetários viram number só onde queremos, e códigos
// com zero à esquerda (série, CST, NCM) não podem ser convertidos para número.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const texto = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
const numero = (v: unknown): number => {
  const n = Number(texto(v));
  return Number.isFinite(n) ? n : 0;
};
const ouNulo = (v: unknown): string | null => {
  const s = texto(v);
  return s === '' ? null : s;
};
const data = (v: unknown): Date | null => {
  const s = texto(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
/** fast-xml-parser devolve objeto quando há 1 ocorrência e array quando há várias. */
const lista = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function lerEndereco(e: Record<string, unknown> | undefined): EnderecoNfe {
  const end = e ?? {};
  return {
    logradouro: texto(end.xLgr),
    numero: texto(end.nro),
    bairro: texto(end.xBairro),
    municipio: texto(end.xMun),
    codigoMunicipio: texto(end.cMun),
    uf: texto(end.UF),
    cep: texto(end.CEP),
  };
}

function lerParte(p: Record<string, unknown> | undefined, chaveEndereco: string): ParteNfe {
  const parte = p ?? {};
  const cnpj = ouNulo(parte.CNPJ);
  return {
    documento: cnpj ?? texto(parte.CPF),
    tipoDocumento: cnpj ? 'CNPJ' : 'CPF',
    nome: texto(parte.xNome),
    ie: ouNulo(parte.IE),
    fone: ouNulo((parte[chaveEndereco] as Record<string, unknown>)?.fone),
    endereco: lerEndereco(parte[chaveEndereco] as Record<string, unknown>),
  };
}

function lerItem(det: Record<string, unknown>): ItemNfe {
  const prod = (det.prod ?? {}) as Record<string, unknown>;
  const imposto = (det.imposto ?? {}) as Record<string, unknown>;
  // O ICMS vem dentro de um filho cujo nome varia com a tributação
  // (ICMS00, ICMS20, ICMSSN102...). Pegar o primeiro filho evita listar todos.
  const icmsRaiz = (imposto.ICMS ?? {}) as Record<string, unknown>;
  const icms = (Object.values(icmsRaiz)[0] ?? {}) as Record<string, unknown>;
  const ipi = ((imposto.IPI ?? {}) as Record<string, unknown>).IPITrib as Record<string, unknown> | undefined;
  return {
    numero: numero(det['@nItem']),
    codigo: texto(prod.cProd),
    descricao: texto(prod.xProd),
    ncm: texto(prod.NCM),
    cst: texto(icms.CST ?? icms.CSOSN),
    cfop: texto(prod.CFOP),
    unidade: texto(prod.uCom),
    quantidade: numero(prod.qCom),
    valorUnitario: numero(prod.vUnCom),
    valorTotal: numero(prod.vProd),
    baseIcms: numero(icms.vBC),
    valorIcms: numero(icms.vICMS),
    aliquotaIcms: numero(icms.pICMS),
    valorIpi: numero(ipi?.vIPI),
  };
}

export function lerNfe(xml: string): NotaFiscalLida {
  const raiz = parser.parse(xml) as Record<string, any>;
  // O Dlinks manda nfeProc (nota + protocolo); aceitar NFe solta também.
  const nfe = raiz?.nfeProc?.NFe ?? raiz?.NFe;
  const inf = nfe?.infNFe;
  if (!inf) throw new Error('XML sem infNFe');

  const ide = (inf.ide ?? {}) as Record<string, unknown>;
  const total = ((inf.total ?? {}) as Record<string, unknown>).ICMSTot as Record<string, unknown> | undefined;
  const tot = total ?? {};
  const infProt = raiz?.nfeProc?.protNFe?.infProt as Record<string, unknown> | undefined;

  return {
    // O Id vem como "NFe26260..." — a chave são os 44 dígitos depois do prefixo.
    chave: texto(inf['@Id']).replace(/^NFe/, ''),
    numero: texto(ide.nNF),
    serie: texto(ide.serie),
    naturezaOperacao: texto(ide.natOp),
    emissaoEm: data(ide.dhEmi) ?? new Date(0),
    saidaEm: data(ide.dhSaiEnt),
    protocolo: ouNulo(infProt?.nProt),
    emitente: lerParte(inf.emit, 'enderEmit'),
    destinatario: lerParte(inf.dest, 'enderDest'),
    itens: lista<Record<string, unknown>>(inf.det).map(lerItem),
    totais: {
      baseIcms: numero(tot.vBC),
      valorIcms: numero(tot.vICMS),
      valorProdutos: numero(tot.vProd),
      valorFrete: numero(tot.vFrete),
      valorSeguro: numero(tot.vSeg),
      valorDesconto: numero(tot.vDesc),
      valorIpi: numero(tot.vIPI),
      valorPis: numero(tot.vPIS),
      valorCofins: numero(tot.vCOFINS),
      valorOutros: numero(tot.vOutro),
      valorTotal: numero(tot.vNF),
    },
    modalidadeFrete: texto(((inf.transp ?? {}) as Record<string, unknown>).modFrete),
    informacoesAdicionais: ouNulo(((inf.infAdic ?? {}) as Record<string, unknown>).infCpl),
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/api && npx jest src/notas/nfe-xml.parser.spec.ts`
Expected: PASS — 9 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notas/nfe-xml.parser.ts apps/api/src/notas/nfe-xml.parser.spec.ts apps/api/src/notas/fixtures/nfe-5060.xml
git commit -m "Le o XML da NF-e para um objeto tipado

Fixture e a nota 5060 real que o Dlinks mandou em 22/09/2026, ja com os
campos IBS/CBS da reforma tributaria.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Código de barras Code128C

**Files:**
- Create: `apps/api/src/notas/codigo-barras.ts`
- Test: `apps/api/src/notas/codigo-barras.spec.ts`

**Interfaces:**
- Produces: `barrasCode128C(digitos: string): number[]` — larguras em módulos, alternando barra/espaço começando por barra. Consumido pela Task 6.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/notas/codigo-barras.spec.ts
import { barrasCode128C } from './codigo-barras';

const CHAVE = '26260961920643000148550030000050601000073367';

describe('barrasCode128C', () => {
  it('recusa quantidade impar de digitos', () => {
    expect(() => barrasCode128C('123')).toThrow('par de dígitos');
  });

  it('recusa caractere que nao e digito', () => {
    expect(() => barrasCode128C('12a4')).toThrow('apenas dígitos');
  });

  it('gera start + pares + checksum + stop', () => {
    // 2 pares => 1 start + 2 dados + 1 checksum = 4 simbolos de 6 modulos,
    // mais o stop de 7 modulos.
    expect(barrasCode128C('1234')).toHaveLength(4 * 6 + 7);
  });

  it('comeca com o padrao do Start C (211232)', () => {
    expect(barrasCode128C('1234').slice(0, 6)).toEqual([2, 1, 1, 2, 3, 2]);
  });

  it('termina com o padrao de Stop (2331112)', () => {
    expect(barrasCode128C('1234').slice(-7)).toEqual([2, 3, 3, 1, 1, 1, 2]);
  });

  it('codifica a chave de 44 digitos da NF-e', () => {
    // 44 digitos = 22 pares; 1 start + 22 dados + 1 checksum = 24 simbolos.
    expect(barrasCode128C(CHAVE)).toHaveLength(24 * 6 + 7);
  });

  it('so produz larguras de 1 a 4 modulos', () => {
    for (const l of barrasCode128C(CHAVE)) {
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(4);
    }
  });

  it('calcula o checksum conforme a especificacao', () => {
    // "1234" => start C (105), dados 12 e 34.
    // checksum = (105 + 12*1 + 34*2) % 103 = (105 + 12 + 68) % 103 = 185 % 103 = 82
    const barras = barrasCode128C('1234');
    const checksum = barras.slice(3 * 6, 4 * 6); // 4o simbolo
    expect(checksum).toEqual([1, 2, 1, 2, 4, 1]); // PADROES[82] === '121241'
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/notas/codigo-barras.spec.ts`
Expected: FAIL — `Cannot find module './codigo-barras'`

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/notas/codigo-barras.ts
/**
 * Code128 conjunto C para a chave de acesso da NF-e (44 dígitos, sempre par,
 * então não precisa trocar de conjunto no meio). Desenhado com retângulos no
 * pdfkit — evita dependência de lib de barcode ou de fonte especial.
 *
 * Cada padrão tem 6 elementos (3 barras e 3 espaços) somando 11 módulos;
 * o Stop tem 7. A sequência devolvida alterna barra/espaço começando por barra.
 */
const PADROES = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112',
];

const START_C = 105;
const STOP = 106;

export function barrasCode128C(digitos: string): number[] {
  if (!/^\d*$/.test(digitos)) throw new Error('Código de barras aceita apenas dígitos');
  if (digitos.length % 2 !== 0) throw new Error('Code128C exige um número par de dígitos');

  const valores: number[] = [START_C];
  for (let i = 0; i < digitos.length; i += 2) {
    valores.push(Number(digitos.slice(i, i + 2)));
  }

  // Checksum: START mais cada valor multiplicado pela sua posição (1-based), módulo 103.
  let soma = START_C;
  for (let i = 1; i < valores.length; i++) soma += valores[i] * i;
  valores.push(soma % 103);
  valores.push(STOP);

  return valores.flatMap((v) => PADROES[v].split('').map(Number));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/notas/codigo-barras.spec.ts`
Expected: PASS — 8 testes.

Se o teste do checksum falhar, conferir a tabela antes de mexer na fórmula: `PADROES[82]` deve ser `'121241'`, `PADROES[105]` (Start C) `'211232'` e `PADROES[106]` (Stop) `'2331112'`. A tabela tem 107 entradas — `expect(PADROES).toHaveLength(107)` é um bom teste extra se houver dúvida.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/notas/codigo-barras.ts apps/api/src/notas/codigo-barras.spec.ts
git commit -m "Gera as barras Code128C da chave de acesso

Sem lib de barcode: a chave tem 44 digitos, sempre par, entao o conjunto C
resolve sozinho e as barras viram retangulos no pdfkit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer do DANFE

**Files:**
- Create: `apps/api/src/notas/danfe.renderer.ts`
- Test: `apps/api/src/notas/danfe.renderer.spec.ts`

**Interfaces:**
- Consumes: `NotaFiscalLida` (Task 4), `barrasCode128C` (Task 5).
- Produces: `renderizarDanfe(nota: NotaFiscalLida): Promise<Buffer>` — consumido pela Task 9.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/notas/danfe.renderer.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lerNfe, NotaFiscalLida } from './nfe-xml.parser';
import { renderizarDanfe } from './danfe.renderer';

const nota = lerNfe(readFileSync(join(__dirname, 'fixtures', 'nfe-5060.xml'), 'utf8'));

describe('renderizarDanfe', () => {
  it('produz um PDF valido', async () => {
    const pdf = await renderizarDanfe(nota);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('aguenta nota com muitos itens sem estourar', async () => {
    const muitos: NotaFiscalLida = {
      ...nota,
      itens: Array.from({ length: 120 }, (_, i) => ({ ...nota.itens[0], numero: i + 1 })),
    };
    const pdf = await renderizarDanfe(muitos);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('nao quebra com campos opcionais ausentes', async () => {
    const magra: NotaFiscalLida = {
      ...nota,
      protocolo: null,
      saidaEm: null,
      informacoesAdicionais: null,
      destinatario: { ...nota.destinatario, ie: null, fone: null },
    };
    const pdf = await renderizarDanfe(magra);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('nao quebra com nota sem itens', async () => {
    const pdf = await renderizarDanfe({ ...nota, itens: [] });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/notas/danfe.renderer.spec.ts`
Expected: FAIL — `Cannot find module './danfe.renderer'`

- [ ] **Step 3: Implementar**

```ts
// apps/api/src/notas/danfe.renderer.ts
import PDFDocument from 'pdfkit';
import { barrasCode128C } from './codigo-barras';
import { NotaFiscalLida, ItemNfe } from './nfe-xml.parser';

const MARGEM = 28;
const LARGURA = 595.28 - MARGEM * 2; // A4 retrato menos as margens

const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const dataHora = (d: Date | null) => (d ? d.toLocaleString('pt-BR', { timeZone: 'America/Recife' }) : '');
const dataCurta = (d: Date | null) => (d ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' }) : '');
/** Chave em grupos de 4, como o DANFE oficial imprime. */
const chaveFormatada = (c: string) => c.replace(/(\d{4})(?=\d)/g, '$1 ');
const doc11 = (d: string) => (d.length === 14
  ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'));

type Doc = InstanceType<typeof PDFDocument>;

/** Caixa com rótulo pequeno em cima e valor embaixo — o tijolo do DANFE. */
function campo(doc: Doc, x: number, y: number, w: number, h: number, rotulo: string, valor: string, opts: { tamanho?: number; alinhar?: 'left' | 'right' | 'center' } = {}) {
  doc.rect(x, y, w, h).stroke();
  doc.fontSize(5).font('Helvetica').text(rotulo.toUpperCase(), x + 3, y + 2.5, { width: w - 6 });
  doc
    .fontSize(opts.tamanho ?? 7.5)
    .font('Helvetica-Bold')
    .text(valor, x + 3, y + 9, { width: w - 6, align: opts.alinhar ?? 'left', ellipsis: true, height: h - 10 });
}

function desenharBarras(doc: Doc, chave: string, x: number, y: number, largura: number, altura: number) {
  const barras = barrasCode128C(chave);
  const modulo = largura / barras.reduce((s, n) => s + n, 0);
  let cursor = x;
  barras.forEach((l, i) => {
    const w = l * modulo;
    if (i % 2 === 0) doc.rect(cursor, y, w, altura).fill('#000'); // par = barra
    cursor += w;
  });
  doc.fillColor('#000');
}

function cabecalho(doc: Doc, nota: NotaFiscalLida, y: number): number {
  const emit = nota.emitente;
  const alturaTopo = 62;

  // Identificação do emitente
  doc.rect(MARGEM, y, 250, alturaTopo).stroke();
  doc.fontSize(9).font('Helvetica-Bold').text(emit.nome, MARGEM + 5, y + 6, { width: 240 });
  doc.fontSize(6.5).font('Helvetica').text(
    `${emit.endereco.logradouro}, ${emit.endereco.numero} - ${emit.endereco.bairro}\n` +
      `${emit.endereco.municipio} / ${emit.endereco.uf} - CEP ${emit.endereco.cep}\n` +
      `CNPJ ${doc11(emit.documento)}   IE ${emit.ie ?? ''}${emit.fone ? `\nFone ${emit.fone}` : ''}`,
    MARGEM + 5,
    y + 22,
    { width: 240 },
  );

  // DANFE + tipo de operação + número/série
  const xDanfe = MARGEM + 250;
  doc.rect(xDanfe, y, 90, alturaTopo).stroke();
  doc.fontSize(11).font('Helvetica-Bold').text('DANFE', xDanfe, y + 5, { width: 90, align: 'center' });
  doc.fontSize(5.5).font('Helvetica').text('Documento Auxiliar da\nNota Fiscal Eletrônica', xDanfe, y + 19, { width: 90, align: 'center' });
  doc.fontSize(6).font('Helvetica-Bold').text('1 - SAÍDA', xDanfe, y + 34, { width: 90, align: 'center' });
  doc.fontSize(7).text(`Nº ${nota.numero}\nSÉRIE ${nota.serie}`, xDanfe, y + 43, { width: 90, align: 'center' });

  // Código de barras + chave
  const xBarras = xDanfe + 90;
  const wBarras = LARGURA - 340;
  doc.rect(xBarras, y, wBarras, alturaTopo).stroke();
  desenharBarras(doc, nota.chave, xBarras + 5, y + 5, wBarras - 10, 28);
  doc.fontSize(5).font('Helvetica').text('CHAVE DE ACESSO', xBarras + 5, y + 36, { width: wBarras - 10 });
  doc.fontSize(6.5).font('Helvetica-Bold').text(chaveFormatada(nota.chave), xBarras + 5, y + 43, { width: wBarras - 10 });

  let yy = y + alturaTopo;
  campo(doc, MARGEM, yy, 250, 18, 'Natureza da operação', nota.naturezaOperacao);
  campo(doc, MARGEM + 250, yy, LARGURA - 250, 18, 'Protocolo de autorização',
    nota.protocolo ? `${nota.protocolo} - ${dataHora(nota.emissaoEm)}` : 'NÃO AUTORIZADA');
  return yy + 18;
}

function parte(doc: Doc, titulo: string, p: NotaFiscalLida['destinatario'], y: number, extras: Array<[string, string]>): number {
  doc.fontSize(6).font('Helvetica-Bold').text(titulo.toUpperCase(), MARGEM, y + 1);
  let yy = y + 9;
  campo(doc, MARGEM, yy, LARGURA - 210, 20, 'Nome / Razão social', p.nome);
  campo(doc, MARGEM + LARGURA - 210, yy, 110, 20, 'CNPJ / CPF', doc11(p.documento));
  campo(doc, MARGEM + LARGURA - 100, yy, 100, 20, 'Inscrição estadual', p.ie ?? 'ISENTO');
  yy += 20;
  campo(doc, MARGEM, yy, LARGURA - 250, 20, 'Endereço', `${p.endereco.logradouro}, ${p.endereco.numero} - ${p.endereco.bairro}`);
  campo(doc, MARGEM + LARGURA - 250, yy, 130, 20, 'Município', p.endereco.municipio);
  campo(doc, MARGEM + LARGURA - 120, yy, 40, 20, 'UF', p.endereco.uf, { alinhar: 'center' });
  campo(doc, MARGEM + LARGURA - 80, yy, 80, 20, 'CEP', p.endereco.cep);
  yy += 20;
  const w = LARGURA / extras.length;
  extras.forEach(([rotulo, valor], i) => campo(doc, MARGEM + i * w, yy, w, 20, rotulo, valor));
  return yy + 20 + 4;
}

function impostos(doc: Doc, nota: NotaFiscalLida, y: number): number {
  doc.fontSize(6).font('Helvetica-Bold').text('CÁLCULO DO IMPOSTO', MARGEM, y + 1);
  const t = nota.totais;
  const linha: Array<[string, number]> = [
    ['Base de cálculo do ICMS', t.baseIcms],
    ['Valor do ICMS', t.valorIcms],
    ['Valor do frete', t.valorFrete],
    ['Valor do seguro', t.valorSeguro],
    ['Desconto', t.valorDesconto],
    ['Valor do IPI', t.valorIpi],
    ['Total dos produtos', t.valorProdutos],
    ['Total da nota', t.valorTotal],
  ];
  const w = LARGURA / linha.length;
  linha.forEach(([rotulo, valor], i) =>
    campo(doc, MARGEM + i * w, y + 9, w, 20, rotulo, moeda(valor), { tamanho: 6.5, alinhar: 'right' }),
  );
  return y + 9 + 20 + 4;
}

const COLUNAS: Array<{ titulo: string; largura: number; alinhar: 'left' | 'right' | 'center'; valor: (i: ItemNfe) => string }> = [
  { titulo: 'Código', largura: 62, alinhar: 'left', valor: (i) => i.codigo },
  { titulo: 'Descrição', largura: 168, alinhar: 'left', valor: (i) => i.descricao },
  { titulo: 'NCM', largura: 42, alinhar: 'center', valor: (i) => i.ncm },
  { titulo: 'CST', largura: 26, alinhar: 'center', valor: (i) => i.cst },
  { titulo: 'CFOP', largura: 28, alinhar: 'center', valor: (i) => i.cfop },
  { titulo: 'Un', largura: 22, alinhar: 'center', valor: (i) => i.unidade },
  { titulo: 'Qtd', largura: 36, alinhar: 'right', valor: (i) => qtd(i.quantidade) },
  { titulo: 'Vl. unit', largura: 46, alinhar: 'right', valor: (i) => moeda(i.valorUnitario) },
  { titulo: 'Vl. total', largura: 50, alinhar: 'right', valor: (i) => moeda(i.valorTotal) },
  { titulo: 'BC ICMS', largura: 44, alinhar: 'right', valor: (i) => moeda(i.baseIcms) },
  { titulo: 'Vl. ICMS', largura: 44, alinhar: 'right', valor: (i) => moeda(i.valorIcms) },
  { titulo: '%', largura: 26, alinhar: 'right', valor: (i) => qtd(i.aliquotaIcms) },
];

function cabecalhoItens(doc: Doc, y: number): number {
  doc.rect(MARGEM, y, LARGURA, 12).stroke();
  let x = MARGEM;
  doc.fontSize(5.5).font('Helvetica-Bold');
  for (const c of COLUNAS) {
    doc.text(c.titulo.toUpperCase(), x + 2, y + 4, { width: c.largura - 4, align: c.alinhar });
    x += c.largura;
    if (x < MARGEM + LARGURA) doc.moveTo(x, y).lineTo(x, y + 12).stroke();
  }
  return y + 12;
}

function itens(doc: Doc, nota: NotaFiscalLida, y: number): number {
  doc.fontSize(6).font('Helvetica-Bold').text('DADOS DOS PRODUTOS / SERVIÇOS', MARGEM, y + 1);
  let yy = cabecalhoItens(doc, y + 9);
  const alturaLinha = 11;
  const limite = 812 - MARGEM; // rodapé da página A4

  for (const item of nota.itens) {
    if (yy + alturaLinha > limite) {
      doc.addPage();
      yy = cabecalhoItens(doc, MARGEM);
    }
    doc.rect(MARGEM, yy, LARGURA, alturaLinha).stroke();
    let x = MARGEM;
    doc.fontSize(5.5).font('Helvetica');
    for (const c of COLUNAS) {
      doc.text(c.valor(item), x + 2, yy + 3, { width: c.largura - 4, align: c.alinhar, ellipsis: true, lineBreak: false });
      x += c.largura;
      if (x < MARGEM + LARGURA) doc.moveTo(x, yy).lineTo(x, yy + alturaLinha).stroke();
    }
    yy += alturaLinha;
  }
  return yy + 4;
}

/**
 * Monta o DANFE em A4 retrato a partir do XML já lido. Não toca em banco nem
 * em HTTP — recebe objeto, devolve bytes; é o que permite testar o layout
 * chamando a função direto, sem subir servidor.
 */
export function renderizarDanfe(nota: NotaFiscalLida): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGEM, bufferPages: true });
    const pedacos: Buffer[] = [];
    doc.on('data', (p: Buffer) => pedacos.push(p));
    doc.on('end', () => resolve(Buffer.concat(pedacos)));
    doc.on('error', reject);

    try {
      doc.lineWidth(0.5).strokeColor('#000');

      // Canhoto de recebimento
      let y = MARGEM;
      doc.rect(MARGEM, y, LARGURA - 70, 26).stroke();
      doc.fontSize(5.5).font('Helvetica').text(
        `RECEBEMOS DE ${nota.emitente.nome} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`,
        MARGEM + 4, y + 4, { width: LARGURA - 80 },
      );
      doc.fontSize(5).text('DATA DE RECEBIMENTO', MARGEM + 4, y + 16);
      doc.fontSize(5).text('IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR', MARGEM + 110, y + 16);
      doc.moveTo(MARGEM + 104, y).lineTo(MARGEM + 104, y + 26).stroke();
      doc.rect(MARGEM + LARGURA - 70, y, 70, 26).stroke();
      doc.fontSize(7).font('Helvetica-Bold').text(`NF-e\nNº ${nota.numero}\nSÉRIE ${nota.serie}`, MARGEM + LARGURA - 68, y + 3, { width: 66, align: 'center' });
      y += 32;

      y = cabecalho(doc, nota, y);
      y += 4;
      y = parte(doc, 'Destinatário / Remetente', nota.destinatario, y, [
        ['Data de emissão', dataCurta(nota.emissaoEm)],
        ['Data de saída', dataCurta(nota.saidaEm)],
        ['Fone', nota.destinatario.fone ?? ''],
      ]);
      y = impostos(doc, nota, y);
      y = itens(doc, nota, y);

      if (nota.informacoesAdicionais) {
        campo(doc, MARGEM, y, LARGURA, 40, 'Informações complementares', nota.informacoesAdicionais, { tamanho: 6 });
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx jest src/notas/danfe.renderer.spec.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Olhar o PDF com olho humano**

```bash
cd apps/api && node -e "
const {readFileSync,writeFileSync}=require('fs');
require('ts-node').register({transpileOnly:true});
const {lerNfe}=require('./src/notas/nfe-xml.parser');
const {renderizarDanfe}=require('./src/notas/danfe.renderer');
renderizarDanfe(lerNfe(readFileSync('./src/notas/fixtures/nfe-5060.xml','utf8')))
  .then(b=>{writeFileSync('danfe-teste.pdf',b);console.log('danfe-teste.pdf', b.length,'bytes');});
"
```

Abrir `apps/api/danfe-teste.pdf` e conferir: canhoto no topo, código de barras legível, chave em grupos de 4, o item BATON GAROTO com quantidade 6 e total 234,00, e "Total da nota" 234,00. Apagar o arquivo depois (`rm apps/api/danfe-teste.pdf`) — não entra no commit.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/notas/danfe.renderer.ts apps/api/src/notas/danfe.renderer.spec.ts
git commit -m "Gera o DANFE em PDF a partir da nota lida

Layout padrao em A4: canhoto, identificacao, destinatario, calculo do
imposto e tabela de itens com quebra de pagina.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Recepção do bloco `nota_fiscal`

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/pedido-faturado.dto.ts`
- Test: `apps/api/src/integracoes-dlinks/pedido-faturado.dto.spec.ts`

**Interfaces:**
- Produces: `NotaFiscalDto` e `PedidoFaturadoDto.nota_fiscal?: NotaFiscalDto` — consumido pela Task 8.

- [ ] **Step 1: Escrever o teste que falha**

O teste mais importante desta tarefa é o do `whitelist`: é ele que trava a regressão do bug de 22/09/2026, em que o bloco `nota_fiscal` era descartado em silêncio.

```ts
// apps/api/src/integracoes-dlinks/pedido-faturado.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PedidoFaturadoDto } from './pedido-faturado.dto';

const CHAVE = '26260961920643000148550030000050601000073367';

const payload = (nota?: Record<string, unknown>) => ({
  pedido_codigo: '2a2d9a5b-5008-4016-bc23-dd8105434d6e',
  status: 'FATURADO',
  valores: { subtotal: 23400, desconto: 0, total: 23400 },
  itens: [{ produto_codigo: '7891008367027', quantidade: 6, valor_unitario: 39 }],
  ...(nota === undefined ? {} : { nota_fiscal: nota }),
});

const notaValida = {
  chave: CHAVE,
  numero: '5060',
  serie: '3',
  emitida_em: '2026-09-22T00:00:00-03:00',
  xml_base64: 'PG5mZVByb2MvPg==',
};

const converter = (bruto: unknown) =>
  plainToInstance(PedidoFaturadoDto, bruto, { excludeExtraneousValues: false });

describe('PedidoFaturadoDto e o bloco nota_fiscal', () => {
  it('nao perde nota_fiscal na conversao (regressao do bug de 22/09/2026)', async () => {
    const dto = converter(payload(notaValida));
    expect(dto.nota_fiscal).toBeDefined();
    expect(dto.nota_fiscal!.chave).toBe(CHAVE);
    expect(dto.nota_fiscal!.numero).toBe('5060');
    expect(dto.nota_fiscal!.serie).toBe('3');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('continua aceitando payload sem nota_fiscal', async () => {
    const dto = converter(payload());
    expect(dto.nota_fiscal).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('recusa chave com menos de 44 digitos', async () => {
    const erros = await validate(converter(payload({ ...notaValida, chave: '2626096192064300014855003000005060100007336' })));
    expect(erros).not.toHaveLength(0);
  });

  it('recusa chave com letra', async () => {
    const erros = await validate(converter(payload({ ...notaValida, chave: `X${CHAVE.slice(1)}` })));
    expect(erros).not.toHaveLength(0);
  });

  it('recusa nota_fiscal sem xml_base64', async () => {
    const { xml_base64, ...semXml } = notaValida;
    const erros = await validate(converter(payload(semXml)));
    expect(erros).not.toHaveLength(0);
  });

  it('aceita nota_fiscal sem emitida_em, que e opcional', async () => {
    const { emitida_em, ...semData } = notaValida;
    expect(await validate(converter(payload(semData)))).toHaveLength(0);
  });

  it('mantem numero e serie como texto, sem virar numero', async () => {
    const dto = converter(payload({ ...notaValida, serie: '03' }));
    expect(dto.nota_fiscal!.serie).toBe('03'); // zero à esquerda preservado
    expect(typeof dto.nota_fiscal!.numero).toBe('string');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/integracoes-dlinks/pedido-faturado.dto.spec.ts`
Expected: FAIL — `dto.nota_fiscal` é `undefined` porque o campo ainda não existe no DTO.

- [ ] **Step 3: Substituir o arquivo inteiro**

```ts
// apps/api/src/integracoes-dlinks/pedido-faturado.dto.ts
import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, ValidateNested,
} from 'class-validator';

const STATUS = ['ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO'] as const;

export class ItemFaturadoDto {
  @IsString()
  produto_codigo!: string;

  @IsNumber()
  quantidade!: number;

  @IsNumber()
  valor_unitario!: number;
}

export class ValoresFaturadoDto {
  @IsNumber()
  subtotal!: number;

  @IsOptional()
  @IsNumber()
  desconto?: number;

  @IsNumber()
  total!: number;
}

/**
 * NF-e que o Dlinks manda junto do faturamento (desde 22/09/2026).
 * `numero` e `serie` ficam como texto de propósito: a série pode ter zero à
 * esquerda e nada aqui é usado em conta.
 */
export class NotaFiscalDto {
  @Matches(/^\d{44}$/, { message: 'chave da NF-e deve ter 44 dígitos' })
  chave!: string;

  @IsString()
  numero!: string;

  @IsString()
  serie!: string;

  @IsOptional()
  @IsDateString()
  emitida_em?: string;

  @IsString()
  xml_base64!: string;
}

export class PedidoFaturadoDto {
  @IsString()
  pedido_codigo!: string;

  @IsIn(STATUS)
  status!: (typeof STATUS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => ValoresFaturadoDto)
  valores?: ValoresFaturadoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemFaturadoDto)
  itens?: ItemFaturadoDto[];

  // Sem este campo declarado, o `whitelist: true` do ValidationPipe
  // (main.ts) descarta o bloco inteiro em silêncio — foi a causa da NF-e
  // não aparecer no app em 22/09/2026.
  @IsOptional()
  @ValidateNested()
  @Type(() => NotaFiscalDto)
  nota_fiscal?: NotaFiscalDto;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx tsc --noEmit && npx jest src/integracoes-dlinks/pedido-faturado.dto.spec.ts`
Expected: compila e os 7 testes passam.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/integracoes-dlinks/pedido-faturado.dto.ts apps/api/src/integracoes-dlinks/pedido-faturado.dto.spec.ts
git commit -m "Aceita o bloco nota_fiscal no payload de pedido faturado

Sem o campo declarado o whitelist do ValidationPipe descartava a NF-e
inteira em silencio.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Gravar a nota, idempotência e centavos

**Files:**
- Modify: `apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts`
- Test: `apps/api/src/integracoes-dlinks/nota-fiscal.spec.ts`

**Interfaces:**
- Consumes: `NotaFiscalDto` (Task 7), `urlNota` (Task 3), `lerNfe` (Task 4).
- Produces: `extrairChaveDoXml(xml: string): string | null` e `normalizarCentavos(v: number): number` exportados do service para teste.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/src/integracoes-dlinks/nota-fiscal.spec.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extrairChaveDoXml, normalizarCentavos } from './dlinks-pedidos.service';

const XML = readFileSync(join(__dirname, '..', 'notas', 'fixtures', 'nfe-5060.xml'), 'utf8');
const CHAVE = '26260961920643000148550030000050601000073367';

describe('extrairChaveDoXml', () => {
  it('tira o prefixo NFe do atributo Id', () => {
    expect(extrairChaveDoXml(XML)).toBe(CHAVE);
  });

  it('devolve null quando o XML nao tem infNFe', () => {
    expect(extrairChaveDoXml('<nfeProc><nada/></nfeProc>')).toBeNull();
  });

  it('devolve null quando o conteudo nem e XML', () => {
    expect(extrairChaveDoXml('isso nao e xml')).toBeNull();
  });
});

describe('normalizarCentavos', () => {
  it('converte o inteiro em centavos que o Dlinks manda', () => {
    // O payload de 22/09/2026 trouxe total 23400 para uma nota de R$ 234,00.
    expect(normalizarCentavos(23400)).toBe(234);
    expect(normalizarCentavos(0)).toBe(0);
    expect(normalizarCentavos(1)).toBe(0.01);
  });

  it('arredonda para duas casas', () => {
    expect(normalizarCentavos(23401)).toBe(234.01);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx jest src/integracoes-dlinks/nota-fiscal.spec.ts`
Expected: FAIL — `extrairChaveDoXml is not a function`

- [ ] **Step 3: Inverter a ordem dos guards em `transicionar()`**

Em `dlinks-pedidos.service.ts`, o bloco atual (linhas ~180-190) é:

```ts
        if (!opts.statusPermitido(atual.rows[0].status)) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
        // Dlinks reenvia o mesmo status várias vezes; sem isso cada envio vira uma linha na linha do tempo do cliente.
        if (atual.rows[0].status === opts.novoStatus) {
          await client.query('rollback');
          processados.push(codigo);
          continue;
        }
```

Trocar para (reenvio checado **antes** do guard):

```ts
        // Dlinks reenvia o mesmo status várias vezes; sem isso cada envio vira
        // uma linha na linha do tempo do cliente. Esta checagem vem ANTES do
        // statusPermitido de propósito: para FATURADO o guard exige
        // status !== 'FATURADO', então um reenvio caía em 'status_invalido'
        // em vez de ser idempotente (bug visto em 22/09/2026).
        if (atual.rows[0].status === opts.novoStatus) {
          await client.query('rollback');
          processados.push(codigo);
          continue;
        }
        if (!opts.statusPermitido(atual.rows[0].status)) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
```

- [ ] **Step 4: Acrescentar os helpers exportados no topo do arquivo**

Logo depois dos `import`s de `dlinks-pedidos.service.ts`:

```ts
import { XMLParser } from 'fast-xml-parser';
import { urlNota } from '../notas/assinatura';
import { NotaFiscalDto } from './pedido-faturado.dto';

const parserChave = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false });

/** Chave de acesso do próprio XML (atributo Id de infNFe, sem o prefixo "NFe"). */
export function extrairChaveDoXml(xml: string): string | null {
  try {
    const raiz = parserChave.parse(xml) as Record<string, any>;
    const id = (raiz?.nfeProc?.NFe ?? raiz?.NFe)?.infNFe?.['@Id'];
    if (!id) return null;
    const chave = String(id).replace(/^NFe/, '');
    return /^\d{44}$/.test(chave) ? chave : null;
  } catch {
    return null;
  }
}

/**
 * O Dlinks manda `valores` em centavos e `itens` em reais — confirmado contra
 * o XML em 22/09/2026 (total 23400 para uma nota de R$ 234,00). Ver
 * docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md.
 */
export function normalizarCentavos(valor: number): number {
  return Math.round(valor) / 100;
}
```

- [ ] **Step 5: Rodar os testes dos helpers**

Run: `cd apps/api && npx jest src/integracoes-dlinks/nota-fiscal.spec.ts`
Expected: PASS — 5 testes.

- [ ] **Step 6: Trocar `marcarFaturado()` inteiro**

```ts
  async marcarFaturado(dto: PedidoFaturadoDto): Promise<ResultadoLote> {
    const { pedido_codigo: pedidoCodigo, status: statusErp, valores, itens, nota_fiscal: notaFiscal } = dto;
    if (statusErp === 'CANCELADO') {
      return this.marcarCancelado([pedidoCodigo]);
    }
    if (statusErp === 'ABERTO' || statusErp === 'EM_FATURAMENTO') {
      return this.transicionar([pedidoCodigo], {
        statusPermitido: (status) => status !== 'CANCELADO' && status !== 'ENTREGUE',
        novoStatus: statusErp,
        detalhe: '',
        operacao: 'pedido_status_erp',
      });
    }

    const resultado = await this.transicionar([pedidoCodigo], {
      statusPermitido: (status) => status !== 'FATURADO' && status !== 'CANCELADO' && status !== 'ENTREGUE',
      novoStatus: 'FATURADO',
      detalhe: '',
      operacao: 'pedido_faturado',
      aposCommit: async (client, codigo) => {
        await creditarIndicacao(client, codigo);
      },
    });

    // A nota grava fora do caminho de transição: no reenvio de FATURADO não há
    // transição, e mesmo assim queremos a NF-e. Só 'nao_encontrado' impede —
    // pedido_notas.pedido_id tem FK para pedidos(id), então gravar antes de
    // saber que o pedido existe estouraria violação de chave estrangeira.
    const inexistente = resultado.ignorados.some((i) => i.codigo === pedidoCodigo && i.motivo === 'nao_encontrado');
    if (!inexistente) {
      if (valores) await this.gravarFaturamento(pedidoCodigo, valores, itens ?? [], notaFiscal);
      if (notaFiscal) await this.gravarNota(pedidoCodigo, notaFiscal);
    }
    return resultado;
  }

  /** Valores reais do faturamento, normalizados de centavos para reais. */
  private async gravarFaturamento(
    codigo: string,
    valores: NonNullable<PedidoFaturadoDto['valores']>,
    itens: NonNullable<PedidoFaturadoDto['itens']>,
    notaFiscal: NotaFiscalDto | undefined,
  ): Promise<void> {
    const { pool } = tenantCtx();
    const total = normalizarCentavos(valores.total);

    // Confere contra o XML quando há nota. Se o Dlinks mudar o formato de
    // `valores` um dia, a gente descobre por este log em vez de voltar a
    // gravar 100x errado em silêncio.
    if (notaFiscal) {
      const xml = Buffer.from(notaFiscal.xml_base64, 'base64').toString('utf8');
      const vNF = Number(/<vNF>([\d.]+)<\/vNF>/.exec(xml)?.[1]);
      if (Number.isFinite(vNF) && Math.abs(vNF - total) > 0.01) {
        this.log.warn(`pedido ${codigo}: total do payload (${total}) diverge do vNF do XML (${vNF})`);
        await pool.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
           values ('faturamento_divergente','erp_para_fluxo',$1,$2,false)`,
          [codigo, `payload ${total} vs XML ${vNF}`],
        );
      }
    }

    await pool.query(
      `insert into pedido_faturamentos (pedido_id, subtotal, desconto, total, itens_json)
       values ($1, $2, $3, $4, $5)
       on conflict (pedido_id) do update set
         subtotal = excluded.subtotal, desconto = excluded.desconto,
         total = excluded.total, itens_json = excluded.itens_json, faturado_em = now()`,
      [
        codigo,
        normalizarCentavos(valores.subtotal),
        normalizarCentavos(valores.desconto ?? 0),
        total,
        JSON.stringify(itens),
      ],
    );
  }

  /** Guarda a NF-e e as URLs assinadas de XML e DANFE. */
  private async gravarNota(codigo: string, nota: NotaFiscalDto): Promise<void> {
    const { pool, tenant } = tenantCtx();
    const xml = Buffer.from(nota.xml_base64, 'base64').toString('utf8');
    const chaveXml = extrairChaveDoXml(xml);

    // Impede a nota ser pendurada no pedido errado — o tipo de erro que só
    // apareceria meses depois, na contabilidade do cliente.
    if (!chaveXml) {
      throw new BadRequestException('xml_base64 não contém uma NF-e válida');
    }
    if (chaveXml !== nota.chave) {
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
         values ('nota_chave_divergente','erp_para_fluxo',$1,$2,false)`,
        [codigo, `payload ${nota.chave} vs XML ${chaveXml}`],
      );
      throw new BadRequestException('chave da nota_fiscal diverge da chave do XML');
    }

    const xmlUrl = urlNota(tenant.slug, codigo, 'xml');
    const pdfUrl = urlNota(tenant.slug, codigo, 'pdf');
    if (!xmlUrl || !pdfUrl) {
      this.log.error(`PUBLIC_URL não configurada — nota do pedido ${codigo} fica sem link de download`);
    }

    await pool.query(
      `insert into pedido_notas (pedido_id, numero_nf, serie, chave_acesso, xml, xml_url, pdf_url, emitida_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (pedido_id) do update set
         numero_nf = excluded.numero_nf, serie = excluded.serie,
         chave_acesso = excluded.chave_acesso, xml = excluded.xml,
         xml_url = excluded.xml_url, pdf_url = excluded.pdf_url,
         emitida_em = excluded.emitida_em`,
      [codigo, nota.numero, nota.serie, nota.chave, xml, xmlUrl, pdfUrl, nota.emitida_em ?? null],
    );
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso)
       values ('nota_fiscal_recebida','erp_para_fluxo',$1,true)`,
      [`${codigo} NF ${nota.numero}/${nota.serie}`],
    );
  }
```

Acrescentar `BadRequestException` ao import de `@nestjs/common` no topo do arquivo.

- [ ] **Step 7: Testar a gravação com pool mockado**

Mesmo padrão de `dlinks-sync-clientes.spec.ts`: `runComTenant` com um `pool` falso, sem banco de verdade. Acrescentar ao fim de `nota-fiscal.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { Logger, BadRequestException } from '@nestjs/common';
import { DlinksPedidosService } from './dlinks-pedidos.service';
import { runComTenant } from '../tenancy/tenant-context';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

const PEDIDO = '2a2d9a5b-5008-4016-bc23-dd8105434d6e';
const XML_B64 = Buffer.from(XML).toString('base64');

function montar() {
  const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
  // `transicionar` usa pool.connect(); aqui só interessa o caminho pós-transição.
  const client = { query: jest.fn(async () => ({ rows: [{ status: 'ENVIADO_ERP' }], rowCount: 1 })), release: jest.fn() };
  const pool = { query, connect: jest.fn(async () => client) };
  return { servico: new DlinksPedidosService(), pool, query };
}

const comTenant = (pool: unknown, fn: () => Promise<unknown>) =>
  runComTenant({ tenant: { slug: 'cahu' }, pool } as never, fn);

describe('gravacao da nota fiscal', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org';
  });

  const nota = { chave: CHAVE, numero: '5060', serie: '3', emitida_em: '2026-09-22T00:00:00-03:00', xml_base64: XML_B64 };
  const dto = (extra: Record<string, unknown> = {}) => ({
    pedido_codigo: PEDIDO,
    status: 'FATURADO' as const,
    valores: { subtotal: 23400, desconto: 0, total: 23400 },
    itens: [{ produto_codigo: '7891008367027', quantidade: 6, valor_unitario: 39 }],
    nota_fiscal: nota,
    ...extra,
  });

  it('grava a nota com XML decodificado e URLs assinadas', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_notas'));
    expect(insert).toBeDefined();
    const params = insert![1] as unknown[];
    expect(params[1]).toBe('5060');          // numero_nf
    expect(params[2]).toBe('3');             // serie
    expect(params[3]).toBe(CHAVE);           // chave_acesso
    expect(String(params[4])).toContain('<nNF>5060</nNF>'); // xml decodificado, nao base64
    expect(String(params[5])).toContain(`/v1/notas/cahu/${PEDIDO}/nota.xml?t=`);
    expect(String(params[6])).toContain(`/v1/notas/cahu/${PEDIDO}/danfe.pdf?t=`);
    expect(String(insert![0])).toContain('on conflict (pedido_id) do update'); // reenvio atualiza
  });

  it('normaliza os centavos do payload ao gravar o faturamento', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_faturamentos'));
    const params = insert![1] as unknown[];
    expect(params[1]).toBe(234); // subtotal, nao 23400
    expect(params[3]).toBe(234); // total
  });

  it('recusa quando a chave do payload diverge da chave do XML', async () => {
    const { servico, pool, query } = montar();
    const chaveErrada = { ...nota, chave: `1${CHAVE.slice(1)}` };
    await expect(
      comTenant(pool, () => servico.marcarFaturado(dto({ nota_fiscal: chaveErrada }) as never)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into pedido_notas'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('nota_chave_divergente'))).toBe(true);
  });

  it('recusa quando o xml_base64 nao contem uma NF-e', async () => {
    const { servico, pool } = montar();
    const lixo = { ...nota, xml_base64: Buffer.from('nao e xml').toString('base64') };
    await expect(
      comTenant(pool, () => servico.marcarFaturado(dto({ nota_fiscal: lixo }) as never)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('grava a nota sem URLs quando PUBLIC_URL nao esta configurada', async () => {
    delete process.env.PUBLIC_URL;
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto() as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into pedido_notas'));
    const params = insert![1] as unknown[];
    expect(params[5]).toBeNull(); // xml_url
    expect(params[6]).toBeNull(); // pdf_url
  });

  it('nao grava nota quando o status do payload nao e FATURADO', async () => {
    const { servico, pool, query } = montar();
    await comTenant(pool, () => servico.marcarFaturado(dto({ status: 'EM_FATURAMENTO' }) as never));
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into pedido_notas'))).toBe(false);
  });
});
```

> Se `marcarFaturado` estiver gravando a nota para status diferente de `FATURADO`, o último teste falha — o guard está no início do método, que desvia `ABERTO`/`EM_FATURAMENTO`/`CANCELADO` antes de chegar na gravação.

- [ ] **Step 8: Compilar e rodar toda a suíte**

Run: `cd apps/api && npx tsc --noEmit && npx jest`
Expected: compila e todos os testes passam (5 dos helpers + 6 da gravação + os pré-existentes).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/integracoes-dlinks/dlinks-pedidos.service.ts apps/api/src/integracoes-dlinks/nota-fiscal.spec.ts
git commit -m "Grava a NF-e do Dlinks e torna o reenvio de FATURADO idempotente

A checagem de reenvio passa para antes do statusPermitido, senao reenviar
FATURADO devolvia status_invalido. A nota grava fora do caminho de
transicao, porque no reenvio nao ha transicao nenhuma.

Valores do payload vem em centavos e agora sao normalizados, com log de
divergencia contra o vNF do XML.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Endpoints de download

**Files:**
- Create: `apps/api/src/notas/notas-tenant.middleware.ts`, `notas.service.ts`, `notas.controller.ts`, `notas.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `assinaturaConfere` (Task 3), `lerNfe` (Task 4), `renderizarDanfe` (Task 6).
- Produces: `GET /v1/notas/:tenant/:pedidoId/nota.xml?t=` e `GET /v1/notas/:tenant/:pedidoId/danfe.pdf?t=`.

- [ ] **Step 1: Middleware de tenant**

```ts
// apps/api/src/notas/notas-tenant.middleware.ts
import { Injectable, NestMiddleware, NotFoundException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { DatabaseService } from '../database/database.service';
import { runComTenant } from '../tenancy/tenant-context';

/**
 * Resolve o tenant pelo slug no caminho da URL. O navegador externo abre estas
 * URLs sem header nenhum (o app usa launchUrl), então o X-Tenant que o
 * TenancyMiddleware espera nunca chega. Mesmo padrão do webhook da MaxiPago —
 * com a diferença de que aqui o slug é público e quem credencia é o HMAC.
 */
@Injectable()
export class NotasTenantMiddleware implements NestMiddleware {
  constructor(private readonly db: DatabaseService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    // req.params não está populado em middleware do Nest; o slug sai do path.
    const partes = req.originalUrl.split('?')[0].split('/').filter(Boolean);
    const slug = partes[partes.indexOf('notas') + 1]?.toLowerCase();
    if (!slug) throw new NotFoundException();
    try {
      const tenant = await this.db.getTenant(slug);
      const pool = await this.db.getTenantPool(slug);
      await runComTenant({ tenant, pool }, async () => next());
    } catch {
      // Tenant inexistente responde 404 igual a pedido inexistente — não
      // confirma para quem está sondando quais slugs existem.
      throw new NotFoundException();
    }
  }
}
```

- [ ] **Step 2: Service**

```ts
// apps/api/src/notas/notas.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { lerNfe } from './nfe-xml.parser';
import { renderizarDanfe } from './danfe.renderer';

export interface NotaGuardada {
  xml: string;
  chave: string;
  numero: string;
}

@Injectable()
export class NotasService {
  private async buscar(pedidoId: string): Promise<NotaGuardada> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select xml, chave_acesso, numero_nf from pedido_notas where pedido_id = $1`,
      [pedidoId],
    );
    if (!rows[0]?.xml) throw new NotFoundException();
    return { xml: rows[0].xml, chave: rows[0].chave_acesso, numero: rows[0].numero_nf };
  }

  async xml(pedidoId: string): Promise<NotaGuardada> {
    return this.buscar(pedidoId);
  }

  /** Gera o DANFE na hora: volume baixo e nunca entrega PDF de um layout velho. */
  async danfe(pedidoId: string): Promise<{ pdf: Buffer; numero: string }> {
    const nota = await this.buscar(pedidoId);
    return { pdf: await renderizarDanfe(lerNfe(nota.xml)), numero: nota.numero };
  }
}
```

- [ ] **Step 3: Controller**

```ts
// apps/api/src/notas/notas.controller.ts
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { assinaturaConfere, TipoArquivo } from './assinatura';
import { NotasService } from './notas.service';

@Controller('notas/:tenant/:pedidoId')
export class NotasController {
  constructor(private readonly notas: NotasService) {}

  /** 404 (e não 403) para assinatura errada: não confirma se o pedido existe. */
  private conferir(tenant: string, pedidoId: string, tipo: TipoArquivo, t: string | undefined) {
    if (!assinaturaConfere(tenant.toLowerCase(), pedidoId, tipo, t)) throw new NotFoundException();
  }

  @Get('nota.xml')
  async xml(
    @Param('tenant') tenant: string,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Query('t') t: string | undefined,
    @Res() res: Response,
  ) {
    this.conferir(tenant, pedidoId, 'xml', t);
    const nota = await this.notas.xml(pedidoId);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="NFe${nota.chave}.xml"`);
    res.send(nota.xml);
  }

  @Get('danfe.pdf')
  async danfe(
    @Param('tenant') tenant: string,
    @Param('pedidoId', ParseUUIDPipe) pedidoId: string,
    @Query('t') t: string | undefined,
    @Res() res: Response,
  ) {
    this.conferir(tenant, pedidoId, 'pdf', t);
    const { pdf, numero } = await this.notas.danfe(pedidoId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="DANFE-${numero}.pdf"`);
    res.send(pdf);
  }
}
```

- [ ] **Step 4: Module**

```ts
// apps/api/src/notas/notas.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NotasController } from './notas.controller';
import { NotasService } from './notas.service';
import { NotasTenantMiddleware } from './notas-tenant.middleware';

@Module({
  controllers: [NotasController],
  providers: [NotasService],
})
export class NotasModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(NotasTenantMiddleware).forRoutes(NotasController);
  }
}
```

- [ ] **Step 5: Ligar no `app.module.ts`**

Acrescentar o import (em ordem alfabética entre `MunicipiosModule` e `OrdersModule`):

```ts
import { NotasModule } from './notas/notas.module';
```

Acrescentar `NotasModule` ao array `imports`, e incluir a rota no `exclude`:

```ts
    // Rotas do Dlinks resolvem o tenant pela apikey (DlinksAuthMiddleware),
    // nunca pelo header X-Tenant — excluir aqui torna isso estrutural.
    // O webhook da MaxiPago resolve o tenant pelo segredo no caminho da URL
    // (MaxipagoAuthMiddleware) — o gateway não conhece nosso header X-Tenant.
    // As notas resolvem pelo slug no caminho (NotasTenantMiddleware) — o
    // navegador externo que abre o XML/DANFE não manda header nenhum.
    consumer
      .apply(TenancyMiddleware)
      .exclude('integracoes/dlinks/(.*)', 'integracoes/maxipago/(.*)', 'notas/(.*)')
      .forRoutes('*');
```

> **Atenção:** este arquivo também foi tocado pela feature de IE/município. Conferir que `MunicipiosModule` continua no `imports` depois da edição.

- [ ] **Step 6: Compilar e subir**

Run: `cd apps/api && npx tsc --noEmit && npm run start:dev`
Expected: compila e sobe sem erro. No log do Nest devem aparecer as rotas `/v1/notas/:tenant/:pedidoId/nota.xml` e `/danfe.pdf`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/notas/notas.module.ts apps/api/src/notas/notas.controller.ts apps/api/src/notas/notas.service.ts apps/api/src/notas/notas-tenant.middleware.ts apps/api/src/app.module.ts
git commit -m "Serve XML e DANFE por URL assinada com o tenant no caminho

O navegador externo nao manda X-Tenant, entao o slug vai no path e um
middleware proprio resolve o tenant, como ja acontece no webhook MaxiPago.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: `xml_url` na lista de notas

**Files:**
- Modify: `apps/api/src/orders/orders.service.ts:222-235`

- [ ] **Step 1: Incluir a coluna no select de `notas()`**

```ts
      `select p.id as pedido_id, p.numero, p.total,
              n.numero_nf, n.chave_acesso, n.pdf_url, n.xml_url, n.emitida_em
         from pedidos p
         join pedido_notas n on n.pedido_id = p.id
        where p.cliente_id = $1
        order by n.emitida_em desc
        limit 20 offset $2`,
```

(O detalhe do pedido já devolve a linha inteira via `row_to_json`, não precisa mudar.)

- [ ] **Step 2: Compilar**

Run: `cd apps/api && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/orders/orders.service.ts
git commit -m "Devolve xml_url na lista de notas fiscais do cliente

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Botão "Baixar XML" no app

**Files:**
- Modify: `apps/mobile/lib/features/orders/pedido_detalhe_screen.dart` (função `_cartaoNota`, ~linha 486)

- [ ] **Step 1: Acrescentar o botão depois do bloco do DANFE**

Dentro de `_cartaoNota`, logo após o `if (n['pdf_url'] != null) ...[ ... ]`, acrescentar:

```dart
                if (n['xml_url'] != null) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () => _abrirUrl('${n['xml_url']}'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                    ),
                    icon: const Icon(Icons.download_outlined, size: 18),
                    label: const Text('Baixar XML da nota'),
                  ),
                ],
```

- [ ] **Step 2: Analisar**

Run: `cd apps/mobile && flutter analyze`
Expected: sem erro novo (avisos pré-existentes podem continuar).

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/features/orders/pedido_detalhe_screen.dart
git commit -m "Botao de baixar o XML da nota no detalhe do pedido

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Links de nota na retaguarda

**Files:**
- Modify: `apps/admin/src/paginas/PedidoDetalhe.tsx` (tipo na linha ~24, render na linha ~141)

- [ ] **Step 1: Alargar o tipo**

```ts
  nota?: {
    numero_nf: string;
    serie?: string | null;
    chave_acesso?: string | null;
    xml_url?: string | null;
    pdf_url?: string | null;
  } | null;
```

- [ ] **Step 2: Trocar a linha do render**

Substituir:

```tsx
            {p.nota && <div style={{ marginTop: 8 }}>NF: <span className="mono">{p.nota.numero_nf}</span></div>}
```

por:

```tsx
            {p.nota && (
              <div style={{ marginTop: 8 }}>
                <div>
                  NF: <span className="mono">{p.nota.numero_nf}</span>
                  {p.nota.serie && <span className="mono"> / {p.nota.serie}</span>}
                </div>
                {p.nota.chave_acesso && (
                  <div className="mono" style={{ fontSize: 11, color: 'var(--texto-2)', marginTop: 2 }}>
                    {p.nota.chave_acesso}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  {p.nota.pdf_url && (
                    <a href={p.nota.pdf_url} target="_blank" rel="noreferrer">Abrir DANFE</a>
                  )}
                  {p.nota.xml_url && (
                    <a href={p.nota.xml_url} target="_blank" rel="noreferrer">Baixar XML</a>
                  )}
                </div>
              </div>
            )}
```

- [ ] **Step 3: Compilar**

Run: `cd apps/admin && npm run build`
Expected: build sem erros.

> **Atenção:** este arquivo tem uma alteração não commitada de outra frente (condicional de status na cobrança). Conferir com `git diff apps/admin/src/paginas/PedidoDetalhe.tsx` antes de commitar e **não** levar junto o que não é desta tarefa.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/paginas/PedidoDetalhe.tsx
git commit -m "Mostra chave e links de XML e DANFE no pedido da retaguarda

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Verificação ponta a ponta

**Files:** nenhum (validação)

- [ ] **Step 1: Suíte completa**

Run: `cd apps/api && npx jest`
Expected: todos os testes passam, incluindo os pré-existentes de `integracoes-dlinks` e `auth`.

- [ ] **Step 2: Aplicar a migração 029 no banco local**

```bash
psql -h localhost -U postgres -d fluxo_cahu -f infra/sql/tenant/029_nfe_xml_serie.sql
psql -h localhost -U postgres -d fluxo_cahu -c "select versao from schema_migrations order by versao desc limit 3"
```
Expected: a lista traz `029`.

- [ ] **Step 3: Reproduzir o payload real que falhou**

Com a API rodando (`PUBLIC_URL=http://localhost:3000`), mandar o payload de 22/09/2026 do pedido `2a2d9a5b-5008-4016-bc23-dd8105434d6e` para `POST /v1/integracoes/dlinks/pedidos-faturados` com a apikey do tenant.

Expected: resposta `{"processados":["2a2d9a5b-..."],"ignorados":[]}` — **não** `status_invalido`, que era o sintoma original.

- [ ] **Step 4: Conferir o que foi gravado**

```bash
psql -h localhost -U postgres -d fluxo_cahu -c "select numero_nf, serie, chave_acesso, length(xml) as xml_bytes, xml_url is not null as tem_xml_url, pdf_url is not null as tem_pdf_url from pedido_notas where pedido_id = '2a2d9a5b-5008-4016-bc23-dd8105434d6e'"
psql -h localhost -U postgres -d fluxo_cahu -c "select subtotal, desconto, total from pedido_faturamentos where pedido_id = '2a2d9a5b-5008-4016-bc23-dd8105434d6e'"
```
Expected: `numero_nf` 5060, `serie` 3, chave de 44 dígitos, `xml_bytes` > 4000, as duas URLs preenchidas. E o faturamento com **total 234.00** (não 23400.00).

- [ ] **Step 5: Abrir os dois arquivos pelas URLs gravadas**

Copiar `xml_url` e `pdf_url` do banco e abrir no navegador.
Expected: o XML baixa como `NFe26260....xml`; o DANFE abre no visualizador com o item BATON GAROTO e total 234,00.

- [ ] **Step 6: Conferir que a assinatura protege**

Trocar um caractere do `?t=` e recarregar; depois trocar o UUID do pedido mantendo o `t`.
Expected: 404 nos dois casos.

- [ ] **Step 7: Confirmar a idempotência**

Mandar o mesmo payload do Step 3 de novo.
Expected: `processados` de novo (não `status_invalido`), e `select count(*) from pedido_eventos where pedido_id = '2a2d9a5b-...' and status = 'FATURADO'` continua **1** — o reenvio não duplica a linha do tempo do cliente.

---

## Deploy

1. `git pull` no .254.
2. Aplicar a migração: `psql ... -f infra/sql/tenant/029_nfe_xml_serie.sql` (o arquivo vai por `scp`; não existe runner automático).
3. **Conferir que `PUBLIC_URL=https://cahudelivery.duckdns.org`** está no ambiente da API. Sem isso as notas gravam sem link.
4. Build da API e da retaguarda, `restart-api.flag`.
5. Build e publicação do APK (o botão de XML é mudança de app).
6. Pedir ao Dlinks para **reenviar** os pedidos já faturados cujas notas se perderam — só chega o que for enviado depois do deploy.

## Pendências externas

- **Confirmar com o Dlinks o formato de `valores`** (centavos vs reais). A divisão por 100 é inferência nossa, batida contra o XML de 22/09/2026, e não está em contrato nenhum. O log `faturamento_divergente` avisa se mudar.
- **Notas antigas** ficam sem XML até o Dlinks reenviar.
