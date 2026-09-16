# Mapa de clientes e pedidos na retaguarda — design

Data: 2026-09-16
Projeto: Fluxo Commerce / CAHU Delivery (retaguarda + API)

## Objetivo

Nova tela **Mapa** na retaguarda que mostra, sobre um mapa, onde estão os clientes
cadastrados e de onde vêm os pedidos. Uso: enxergar concentração e buracos de
cobertura da carteira, e ver a distribuição dos pedidos por região para ajudar a
organizar entregas.

Não é roteirização. A coordenada vem do CEP (precisão de rua/bairro), então o
mapa indica região, não o portão do cliente.

## Decisões

- Clientes e pedidos na mesma tela, com alternância Clientes / Pedidos / Ambos.
- Pedidos filtrados por **período** (Hoje, 7 dias, 30 dias) **e** por **status**
  (mesmas pílulas da tela Pedidos).
- Geocodificação **grátis**: BrasilAPI pelo CEP, com Nominatim (OpenStreetMap)
  como reserva para endereço completo. Sem chave, sem custo.
- Coordenada **gravada no banco** e produzida por um **job noturno**; a tela nunca
  chama serviço externo.
- Clique no ponto abre um **balão** simples com link para a tela do cliente ou do
  pedido já existente. Sem painel lateral.
- Mapa: **Leaflet** + tiles do OpenStreetMap, com agrupamento (cluster) de pontos
  próximos.

## 1. Banco de dados

Migração `infra/sql/tenant/023_geocodificacao_enderecos.sql`:

```sql
alter table cliente_enderecos
  add column if not exists latitude          double precision,
  add column if not exists longitude         double precision,
  add column if not exists geo_precisao      text check (geo_precisao in ('cep','endereco')),
  add column if not exists geocodificado_em  timestamptz,
  add column if not exists geo_tentativas    int not null default 0,
  add column if not exists geo_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_geo_pendente_idx
  on cliente_enderecos (geo_tentativas) where latitude is null;
```

- `geo_precisao = 'endereco'` quando o Nominatim resolveu rua+número; `'cep'`
  quando só o CEP resolveu.
- `geo_tentativas` limita a 5 tentativas por endereço; depois disso o endereço
  fica como "sem localização" até alguém corrigir o CEP.
- A tabela `pedidos` **não muda**. O pedido é posicionado pelo endereço do
  cliente cujo `cep` e `numero` batem com `endereco_snapshot_json`; se não achar,
  usa o endereço `padrao = true` do cliente; se ainda assim não tiver
  coordenada, o pedido conta como "sem localização".

## 2. Job de geocodificação

Arquivos novos `apps/api/src/geo/geocodificacao.worker.ts`,
`geocodificacao.service.ts` e `geo.module.ts`, no mesmo padrão do
`orders/outbox.worker.ts` (`setInterval` dentro da API, sem BullMQ).

- Agenda: a cada 60 s verifica a hora; roda **uma vez por dia às 03:00** (hora
  local do servidor). Guarda em memória a data da última execução para não
  repetir no mesmo dia.
- Também roda **sob demanda** via `POST /admin/mapa/geocodificar` (botão na
  tela). Se já houver execução em andamento, responde `{ emAndamento: true }` e
  não inicia outra.
- Seleção: `latitude is null and geo_tentativas < 5`, ordenado por
  `geo_ultima_tentativa_em nulls first`, em lotes de 200.
- Por endereço:
  1. `GET https://brasilapi.com.br/api/cep/v2/{cep}`. Se vier
     `location.coordinates.latitude/longitude`, grava com precisão `cep`.
  2. Senão, `GET https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&street={numero} {logradouro}&city={cidade}&state={uf}`
     com header `User-Agent: FluxoCommerce/1.0 (contato@fluxocerto.com.br)`.
     Se retornar resultado, grava com precisão `endereco`.
  3. Sem resultado em ambos: incrementa `geo_tentativas`, grava
     `geo_ultima_tentativa_em`.
- Ritmo: **1 requisição por segundo** (exigência do Nominatim; aplicada a ambas
  as fontes por simplicidade). Timeout de 8 s por chamada; erro de rede conta
  como tentativa.
- Log por execução: total processado, resolvidos por CEP, por endereço,
  falhas. Usa o logger padrão do Nest.
- Nenhuma escrita no ERP. Nada muda no sync do Dlinks.

## 3. Endpoint

`GET /admin/mapa?de=YYYY-MM-DD&ate=YYYY-MM-DD&status=RECEBIDO,FATURADO,...`
(no `admin.controller.ts`, protegido pelo mesmo guard das demais rotas admin).

- `de`/`ate` opcionais; padrão = últimos 7 dias. `status` opcional, lista
  separada por vírgula; padrão = todos exceto `CANCELADO`.
- Resposta:

```json
{
  "clientes": [
    { "id": "...", "nome": "Mercadinho X", "documento": "...", "cidade": "Petrolina",
      "bairro": "Centro", "endereco": "Rua A, 10", "lat": -9.39, "lng": -40.50,
      "precisao": "cep" }
  ],
  "pedidos": [
    { "id": "...", "numero": 3, "clienteId": "...", "cliente": "Teste Dlinks",
      "status": "RECEBIDO", "total": 127.28, "criadoEm": "2026-09-14T09:38:00Z",
      "endereco": "Rua A, 10 - Centro, Petrolina", "lat": -9.39, "lng": -40.50 }
  ],
  "semLocalizacao": { "clientes": 12, "pedidos": 1 },
  "geocodificacao": { "emAndamento": false, "ultimaExecucaoEm": "2026-09-16T03:00:12Z" }
}
```

- Clientes: um ponto por cliente, usando o endereço padrão (ou o primeiro com
  coordenada). Só clientes com `status <> 'bloqueado'`.
- Pedidos: um ponto por pedido, resolvido conforme a regra da seção 1.
- `POST /admin/mapa/geocodificar` dispara o job; responde
  `{ iniciado: true }` ou `{ emAndamento: true }`.

## 4. Tela Mapa (retaguarda)

- Rota `/mapa`, página `apps/admin/src/paginas/Mapa.tsx`. Item de menu
  `🗺️ Mapa` logo abaixo de `🧾 Pedidos` no `Layout.tsx`.
- Dependências novas em `apps/admin`: `leaflet`, `@types/leaflet`,
  `leaflet.markercluster`, `@types/leaflet.markercluster`. CSS do Leaflet e do
  cluster importados no próprio componente.
- Layout (controles **acima** do mapa, nunca em rodapé):
  - Linha 1: alternância `Clientes | Pedidos | Ambos` (padrão Ambos) e, à
    direita, aviso "N clientes / M pedidos sem localização" + botão
    **Geocodificar pendentes** (desabilitado com texto "Geocodificando..."
    enquanto `emAndamento`).
  - Linha 2: pílulas de status (mesmas da tela Pedidos, multi-seleção,
    "Todos" = todos exceto cancelado) e período `Hoje | 7 dias | 30 dias`.
    Só aparece quando Pedidos ou Ambos.
  - Mapa ocupando o restante da altura (mín. 520 px), centro inicial no
    centroide dos pontos carregados; se não houver pontos, centro em Petrolina
    (-9.39, -40.50) zoom 12.
- Marcadores:
  - Cliente: círculo cinza (`#6b7280`) raio 7.
  - Pedido: círculo amarelo CAHU (`#FFD500`) com borda; cor da borda por
    status: RECEBIDO/ENVIADO_ERP preto, FATURADO/EM_SEPARACAO azul,
    SAIU_ENTREGA laranja, ENTREGUE verde, FALHA_INTEGRACAO vermelho.
  - Cluster com contagem quando há sobreposição (padrão do markercluster).
- Balão (popup):
  - Cliente: nome, documento, endereço; link `Abrir cliente` para
    `/clientes?busca={documento}`.
  - Pedido: `#numero`, cliente, badge de status, total formatado em R$, data;
    link `Abrir pedido` para `/pedidos/{id}`.
  - Se `precisao = 'cep'`, linha discreta "Localização aproximada pelo CEP".
- Estado: filtros na URL (`?modo=&status=&periodo=`) como nas outras telas, para
  o link ser compartilhável. Carregamento com skeleton/spinner padrão e estado
  de erro com botão "Tentar de novo".
- Após clicar em Geocodificar pendentes, a tela consulta `GET /admin/mapa` a
  cada 10 s até `emAndamento` voltar a `false`, então recarrega os pontos.

## Erros e limites

- Serviço externo fora do ar: o job registra falha e segue; a tela nunca é
  afetada porque só lê o banco.
- CEP inválido ou genérico: após 5 tentativas o endereço para de ser tentado e
  passa a contar em "sem localização".
- Volume: a CAHU tem centenas de clientes, não dezenas de milhares; o job
  noturno a 1 req/s cobre isso em minutos. Sem paginação no endpoint por ora.

## Testes

- Unitário do serviço de geocodificação com HTTP mockado: resolve por CEP,
  cai para Nominatim, falha e incrementa tentativa, respeita limite de 5.
- Unitário da resolução pedido para endereço: bate por cep+numero, cai para
  padrão, sem coordenada conta em `semLocalizacao`.
- Smoke manual: aplicar migração no banco dev, rodar o job, abrir `/mapa`,
  conferir clientes e pedidos de teste no mapa, clicar e abrir pedido.

## Fora de escopo

- Roteirização / ordem de entrega.
- Google Geocoding (schema já preparado via `geo_precisao`; um adaptador Google
  pode ser adicionado depois sem mudar schema).
- Mapa no app do cliente.
- Área de entrega / raio de atendimento.
