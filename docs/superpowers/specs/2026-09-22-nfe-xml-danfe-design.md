# NF-e do Dlinks — XML guardado e DANFE gerado — Design

## Contexto

Em 22/09/2026 o Dlinks passou a enviar o bloco `nota_fiscal` dentro do
`POST /v1/integracoes/dlinks/pedidos-faturados`, com a chave de acesso, número, série,
data de emissão e o XML inteiro em base64:

```json
{
  "pedido_codigo": "2a2d9a5b-...",
  "status": "FATURADO",
  "valores": { "subtotal": 23400, "desconto": 0, "total": 23400 },
  "itens": [{ "produto_codigo": "7891008367027", "quantidade": 6, "valor_unitario": 39 }],
  "nota_fiscal": {
    "chave": "26260961920643000148550030000050601000073367",
    "numero": "5060",
    "serie": "3",
    "emitida_em": "2026-09-22T00:00:00-03:00",
    "xml_base64": "..."
  }
}
```

A nota não apareceu no app. A investigação (22/09/2026) achou duas causas independentes:

**Causa 1 — a API nunca recebe o bloco.** `PedidoFaturadoDto`
(`apps/api/src/integracoes-dlinks/pedido-faturado.dto.ts`) declara só `pedido_codigo`,
`status`, `valores` e `itens`. Com `whitelist: true` no `ValidationPipe`
(`apps/api/src/main.ts:21`), qualquer propriedade não declarada é **removida em silêncio**
do body — sem erro, sem log. O `nota_fiscal` inteiro é descartado antes de o service ver.

**Causa 2 — o reenvio devolve `status_invalido`.** O pedido em questão já estava `FATURADO`.
Em `transicionar()` (`dlinks-pedidos.service.ts`), o guard `statusPermitido` (linha 180) roda
**antes** da checagem de reenvio do mesmo status (linha 186). Para `FATURADO → FATURADO` a
ordem está invertida: cai em `status_invalido` em vez de ser tratado como idempotente. Como
consequência o `aposCommit` nem executa — nem `pedido_faturamentos` é atualizado num reenvio.

### O que já existe (não precisa ser construído)

Levantamento do código atual — a maior parte do caminho já está pronta:

- **Tabela `pedido_notas`** (`infra/sql/tenant/001_schema_inicial.sql:244`) com
  `pedido_id`, `numero_nf`, `chave_acesso`, `xml_url`, `pdf_url`, `emitida_em`.
- **API do cliente:** `GET /v1/pedidos/:id` já devolve a nota (`orders.service.ts:247`) e
  `GET /v1/pedidos/notas` já lista as notas do cliente (`orders.service.ts:222`).
- **App Flutter:** o cartão "Nota fiscal" do detalhe do pedido já mostra número, data, chave
  copiável e botão "Abrir DANFE (PDF)" (`pedido_detalhe_screen.dart:451`); a lista "Notas
  fiscais" no Perfil já existe (`notas_fiscais_screen.dart`, spec de 27/07/2026).
- **Retaguarda:** `admin.service.ts:94` já devolve a nota inteira no detalhe do pedido.

**O que falta é só o caminho de escrita a partir do push do Dlinks.** Hoje `pedido_notas` só
é preenchida pelo outbox worker via adapter (`outbox.worker.ts:146`), e
`DlinksPullAdapter.obterNotaFiscal()` (`integration.service.ts:112`) lança
`'DlinksPullAdapter não recebe NF do Dlinks ainda — endpoint pendente de confirmação'`.
Essa confirmação chegou: o Dlinks manda junto no `/pedidos-faturados`.

### Dois achados do payload que condicionam o design

**A NF-e já é da reforma tributária.** O XML traz `IBSCBS`, `gIBSCBS`, `vNFTot` (NT 2025).
Isso descarta as bibliotecas de DANFE prontas do Node — as poucas que existem são antigas e
quebram ou ignoram esses campos.

**O Dlinks manda `valores` em centavos e `itens` em reais.** No payload, `total: 23400` com
`valor_unitario: 39 × quantidade 6 = 234`, e o XML confirma `<vNF>234.00</vNF>`. O código
atual grava `valores.total` direto numa coluna `numeric(12,2)`
(`dlinks-pedidos.service.ts:136`) — **R$ 23.400,00 no lugar de R$ 234,00, 100× errado**.
Passou despercebido porque nada lê `pedido_faturamentos` ainda. Com a nota visível no app,
os dois números passam a aparecer lado a lado e a divergência ficaria escancarada.

## Decisões confirmadas com o Tiago (22/09/2026)

- **DANFE:** gerado pela nossa API a partir do XML, no **layout padrão completo** (canhoto,
  quadros de emitente/destinatário/impostos, tabela de itens, código de barras da chave).
  Descartado pedir o PDF pro Dlinks (trava o prazo) e descartado o espelho simplificado
  (não serve pra conferência de mercadoria).
- **Acesso:** URL assinada por HMAC, servida por endpoint próprio. O app abre PDF com
  `launchUrl(..., externalApplication)` (`pedido_detalhe_screen.dart:56`), ou seja **no
  navegador externo, sem o JWT** — a URL precisa se autenticar sozinha.
- **Armazenamento:** XML numa coluna do Postgres (entra no backup do banco, não depende de
  alguém lembrar de copiar pasta); DANFE gerado sob demanda, sem cache.
- **Retaguarda:** a equipe da CAHU também baixa XML e DANFE pelo detalhe do pedido.

## Arquitetura

### 1. Recepção — `pedido-faturado.dto.ts`

Classe nova `NotaFiscalDto` e campo opcional em `PedidoFaturadoDto`:

```ts
export class NotaFiscalDto {
  @Matches(/^\d{44}$/, { message: 'chave deve ter 44 dígitos' })
  chave!: string;

  @IsString() numero!: string;
  @IsString() serie!: string;

  @IsOptional() @IsDateString() emitida_em?: string;

  @IsString() xml_base64!: string;
}
```

```ts
@IsOptional()
@ValidateNested()
@Type(() => NotaFiscalDto)
nota_fiscal?: NotaFiscalDto;
```

`numero` e `serie` são `string` de propósito: o Dlinks manda `"5060"` e `"3"` como texto, e
série pode ter zero à esquerda. Não converter pra número.

**Validação de coerência (no service, não no DTO):** decodificar o base64 e conferir que a
chave declarada bate com a do XML (`infNFe@Id`, que vem prefixado com `NFe`). Se divergir,
responder 400 e logar em `integracao_logs`. É o que impede uma nota ser anexada ao pedido
errado — erro que só apareceria meses depois, na contabilidade do cliente.

Se o base64 não decodificar ou o XML não tiver `infNFe`, mesmo tratamento: 400 + log.

### 2. Gravação desacoplada do status — `dlinks-pedidos.service.ts`

Duas mudanças em `transicionar()`:

**(a) Inverter a ordem dos guards.** A checagem "status atual já é o novo status"
(linha 186) passa pra **antes** de `statusPermitido` (linha 180). Efeito: reenvio de
`FATURADO` devolve `processados` (idempotente) em vez de `status_invalido`. O bloco de
reenvio faz `rollback` e `continue`, então nenhuma linha extra entra em `pedido_eventos` —
comportamento que já era o desejado (commit 7f55304) e que só não valia pro `FATURADO`.

**(b) A nota grava sempre que vier no payload.** Hoje a gravação dependeria de `aposCommit`,
que só roda quando há transição de status — num reenvio a nota continuaria sendo perdida.
`marcarFaturado()` passa a gravar a nota num passo próprio, fora do caminho de transição.

**Ordem importa:** a gravação acontece **depois** de `transicionar()`, e só se o resultado
não trouxe esse código como `nao_encontrado`. `pedido_notas.pedido_id` tem FK pra
`pedidos(id)` — gravar antes estouraria violação de chave estrangeira quando o Dlinks
mandasse um `pedido_codigo` que não existe no nosso banco. Rodando depois, o caso vira o
`nao_encontrado` que o Dlinks já sabe interpretar.

Note que `status_invalido` (pedido `CANCELADO`/`ENTREGUE`) **não** impede a gravação da
nota: se o ERP faturou, a nota é um fato, mesmo que o status local não aceite a transição.
Só `nao_encontrado` impede — aí não há onde pendurar.

O upsert é idempotente:

```sql
insert into pedido_notas (pedido_id, numero_nf, serie, chave_acesso, xml, xml_url, pdf_url, emitida_em)
values ($1,$2,$3,$4,$5,$6,$7,$8)
on conflict (pedido_id) do update set
  numero_nf = excluded.numero_nf, serie = excluded.serie,
  chave_acesso = excluded.chave_acesso, xml = excluded.xml,
  xml_url = excluded.xml_url, pdf_url = excluded.pdf_url,
  emitida_em = excluded.emitida_em
```

(O worker usa `do nothing` — aqui é `do update` de propósito: se o Dlinks reenviar a nota
corrigida, a gente quer a versão nova.)

Só grava nota quando o **status do payload** é `FATURADO`. Se vier `nota_fiscal` junto de
`CANCELADO`, `ABERTO` ou `EM_FATURAMENTO`, ignorar o bloco e logar — não é cenário esperado.
(Não confundir com o status local do pedido, tratado no parágrafo acima: aquele não bloqueia
a gravação, este sim.)

### 3. Valores em centavos — `marcarFaturado()`

`valores.*` são divididos por 100 antes de gravar em `pedido_faturamentos`, com comentário
explícito no código apontando pra esta spec.

Quando houver nota, comparar o total normalizado com o `vNF` do XML e **logar divergência**
(warn + `integracao_logs`), sem bloquear a gravação. Assim, se o Dlinks mudar o formato um
dia, a gente descobre pelo log em vez de voltar a gravar 100× errado em silêncio.

> **Pendência externa:** confirmar o formato de `valores` com o Dlinks. A divisão por 100 é
> a leitura correta do payload observado em 22/09/2026 (batida contra o XML), mas é uma
> inferência nossa — não está escrita em contrato nenhum.

### 4. Banco — migração `029_nfe_xml_serie.sql`

```sql
alter table pedido_notas add column if not exists serie text;
alter table pedido_notas add column if not exists xml   text;

insert into schema_migrations (versao) values ('029') on conflict do nothing;
```

O XML é guardado **decodificado**, não em base64: ocupa ~25% menos, é legível num `select`
na hora de investigar, e o base64 não agrega nada.

Não existe runner de migração no projeto — a 029 é aplicada à mão no .254 via `psql`
(arquivo enviado por `scp`), como as anteriores.

> A 028 ficou com `028_ie_e_municipio.sql` (IE do cliente + código IBGE do município),
> desenvolvida em paralelo em 22/09/2026. Por isso a da NF-e é a 029.

### 5. Servir os arquivos — módulo novo `apps/api/src/notas/`

Endpoints **sem** `JwtAuthGuard` — validam só a assinatura:

```
GET /v1/notas/:tenant/:pedidoId/nota.xml?t=<hmac>
GET /v1/notas/:tenant/:pedidoId/danfe.pdf?t=<hmac>
```

**O tenant vai no caminho da URL, não no header.** `TenancyMiddleware` resolve o tenant pelo
header `X-Tenant` e `tenantCtx()` lança 400 quando ele falta (`tenant-context.ts:17`) — mas
o navegador externo não manda header nenhum. É exatamente o problema que a MaxiPago já
tem, e a solução aqui é a mesma (`maxipago-auth.middleware.ts`): um `NotasTenantMiddleware`
lê o slug do path e chama `runComTenant()`. Diferença: no caso da MaxiPago o valor no path é
um segredo (credencial + identificação); aqui o slug é público e quem credencia é o HMAC.

`app.module.ts` precisa incluir `'notas/(.*)'` na lista de `exclude()` do `TenancyMiddleware`,
junto de `integracoes/dlinks/(.*)` e `integracoes/maxipago/(.*)`.

`t` = HMAC-SHA256 de `` `${tenantSlug}:${pedidoId}:${tipo}` `` com `JWT_SECRET`, em hex
truncado em 32 caracteres. Comparação com `timingSafeEqual`. O slug entra no HMAC pra que
uma assinatura válida num tenant não valha noutro. Propriedades:

- **Estável** — pode ser calculada no faturamento e gravada em `xml_url`/`pdf_url`, que é o
  que o app e a retaguarda já leem.
- **Abre no navegador externo** sem login, que é o requisito do `launchUrl`.
- **Trocar o `:pedidoId` na URL não abre a nota de outro cliente** — a assinatura não confere.

**URL absoluta:** montada com `process.env.PUBLIC_URL`, mesmo padrão já usado para fotos
(`admin-upload.controller.ts:39`). Aqui não há `req` disponível (a URL é gravada no momento
do faturamento, dentro do service), então `PUBLIC_URL` é **obrigatória** — se estiver vazia,
o service loga erro e grava a nota com `xml_url`/`pdf_url` nulos, em vez de gravar uma URL
quebrada. No .254 o valor é `https://cahudelivery.duckdns.org`.

Headers: `Content-Disposition: attachment; filename="NFe<chave>.xml"` pro XML (o cliente
repassa pro contador) e `inline; filename="DANFE-<numero>.pdf"` pro PDF (abre no visualizador).

> **Limitação aceita explicitamente:** essas URLs não expiram. Quem receber o link (print,
> encaminhamento, log de proxy intermediário) enxerga aquela nota indefinidamente. É o preço
> de abrir no navegador externo sem sessão; decisão tomada de olho aberto em 22/09/2026.
> Se um dia virar problema, o caminho é token com expiração + refresh pela API autenticada.

### 6. Geração do DANFE — peças isoladas

```
apps/api/src/notas/
  nfe-xml.parser.ts          XML (string) → NotaFiscalLida (objeto tipado)
  nfe-xml.parser.spec.ts
  danfe.renderer.ts          NotaFiscalLida → Buffer (PDF)
  danfe.renderer.spec.ts
  codigo-barras.ts           chave (44 dígitos) → barras Code128C pro pdfkit
  codigo-barras.spec.ts
  assinatura.ts              assina/verifica o HMAC das URLs
  assinatura.spec.ts
  notas-tenant.middleware.ts resolve o tenant pelo slug no path
  notas.service.ts           busca XML no banco → parser → renderer
  notas.controller.ts        valida HMAC, responde o arquivo
  notas.module.ts
  fixtures/nfe-5060.xml      XML real do pedido 5060 (22/09/2026)
```

Cada peça tem uma responsabilidade e é testável sozinha:

- `nfe-xml.parser.ts` não sabe de HTTP nem de banco. Recebe string, devolve objeto.
- `danfe.renderer.ts` não sabe de HTTP, de banco nem de XML. Recebe objeto, devolve Buffer.
- `notas.service.ts` é a única peça que toca no banco.

Isso mantém cada arquivo pequeno o bastante pra ser lido inteiro, e permite iterar no layout
do DANFE sem subir servidor — o teste do renderer chama a função direto com o fixture.

**`NotaFiscalLida`** (em `nfe-xml.parser.ts`): chave, protocolo de autorização, número,
série, natureza da operação, emissão/saída, emitente (CNPJ, IE, razão, endereço completo,
fone), destinatário (CNPJ/CPF, IE, razão, endereço), itens (código, descrição, NCM, CST,
CFOP, unidade, quantidade, valor unitário, valor total, base de cálculo, ICMS, IPI),
totais (`ICMSTot` completo) e transporte (modalidade do frete).

**Dependências novas:** `fast-xml-parser` e `pdfkit`. As duas em **JS puro, sem build
nativo** — escolha deliberada, o .254 é Windows e lib com compilação nativa dá dor de cabeça
no deploy. Puppeteer foi descartado pelo mesmo motivo (baixaria um Chromium no servidor).

**Código de barras:** Code128C desenhado direto com retângulos no pdfkit
(`codigo-barras.ts`), sem lib nem fonte extra. A chave tem 44 dígitos — par, então o
Code128C codifica em 22 pares sem precisar de troca de conjunto.

**Geração sob demanda, sem cache.** O volume é baixo (dezenas de notas por dia) e evita PDF
desatualizado se mexermos no layout. Se virar gargalo, cachear é uma mudança local ao
`notas.service.ts`.

### 7. Onde aparece

**App Flutter** — `pedido_detalhe_screen.dart`, `_cartaoNota()`: o botão "Abrir DANFE (PDF)"
já existe e passa a funcionar sozinho assim que `pdf_url` for preenchido. Acrescentar um
botão "Baixar XML" (`Icons.code`/`Icons.download_outlined`) quando `xml_url != null`, no
mesmo padrão visual do botão do DANFE, reaproveitando `_abrirUrl`.

**Lista de notas do Perfil** — `orders.service.ts:226` não seleciona `xml_url` hoje.
Incluir no `select` para a lista também poder oferecer o XML.

**Retaguarda** — `apps/admin/src/paginas/PedidoDetalhe.tsx:141` mostra só
`NF: <numero_nf>`. Acrescentar dois links (XML e DANFE) ao lado, e estender o tipo `nota`
(linha 24) para incluir `xml_url`, `pdf_url` e `chave_acesso` — a API
(`admin.service.ts:94`) já devolve a linha inteira, é só o tipo do front que está estreito.

## Testes

- **Parser** (`nfe-xml.parser.spec.ts`), contra o fixture real: chave, número, série,
  emitente, destinatário, item único com descrição/NCM/CFOP, `vNF = 234.00`. Um caso
  garantindo que os campos da reforma (`IBSCBS`) não quebram o parse.
- **Código de barras** (`codigo-barras.spec.ts`): a chave de 44 dígitos gera a sequência de
  barras esperada, com start C, checksum e stop corretos.
- **Renderer** (`danfe.renderer.spec.ts`): produz um Buffer que começa com `%PDF`, não
  estoura ao receber nota com muitos itens, e não lança com campos opcionais ausentes
  (destinatário sem IE, nota sem transportadora).
- **DTO/recepção**: `nota_fiscal` válido é aceito; chave com menos de 44 dígitos é recusada;
  chave do JSON divergente da do XML é recusada com 400.
- **Idempotência** (`dlinks-pedidos.service`): pedido já `FATURADO` recebendo `FATURADO` de
  novo devolve `processados` (não `status_invalido`) **e** grava/atualiza a nota.
- **Ordem da gravação**: `pedido_codigo` inexistente com `nota_fiscal` no payload devolve
  `nao_encontrado` sem estourar erro de FK, e não deixa linha órfã em `pedido_notas`.
- **Centavos**: `valores.total = 23400` com XML `vNF = 234.00` grava `234.00` em
  `pedido_faturamentos` e não registra divergência; um total que não bata com o XML grava
  assim mesmo e registra o log de divergência.
- **HMAC** (`notas.controller`): assinatura válida abre; assinatura de outro pedido na URL
  deste pedido devolve 404; sem `t` devolve 404. (404 e não 403, pra não confirmar a
  existência do pedido a quem está sondando.)

## Fora de escopo

- **Notificação push quando a nota é emitida.** Não foi pedido e dobra o escopo (FCM,
  preferência do cliente, tela de notificações).
- **Reenvio manual de nota pela retaguarda.** O upsert do item 2 já cobre reenvio do Dlinks;
  botão manual é outro problema.
- **Cache do DANFE.** Decidido gerar sob demanda; cachear depois é mudança local.
- **Backfill de notas antigas.** Só notas que chegarem a partir do deploy terão XML. Pedidos
  faturados antes disso continuam sem nota no app — o Dlinks teria que reenviá-los.
- **Expiração/rotação das URLs assinadas.** Ver limitação aceita no item 5.
