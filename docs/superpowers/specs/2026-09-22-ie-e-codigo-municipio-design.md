# Inscrição Estadual no cadastro CNPJ e código do município resolvido automaticamente

**Data:** 2026-09-22
**Status:** aprovado pelo Tiago (brainstorming em sessão)

## Problema

Para cadastrar no ERP um cliente que se cadastrou sozinho pelo app, a CAHU precisa de dois dados que o app não coleta:

1. **Inscrição Estadual** — não existe campo nenhum de IE no projeto (app, API ou banco).
2. **Código do município (IBGE)** — o ERP exige, mas o cliente não sabe o dele. Não dá para simplesmente perguntar.

O preenchimento de endereço pelo CEP **já existe e funciona** (`_buscarCep` em `apps/mobile/lib/features/auth/cadastro_screen.dart`, via ViaCEP). O ViaCEP já devolve o código IBGE do município na mesma resposta — hoje esse campo é descartado.

## Decisão

- **IE obrigatória para CNPJ, com escape "Isento"**. Muito cliente de distribuidora (MEI, bar, mercearia) é isento; obrigar sem saída travaria o cadastro dessas pessoas.
- **Código do município nunca é perguntado ao cliente.** É capturado do ViaCEP quando disponível e, quando não, resolvido depois por um worker que consulta a API de municípios do IBGE por cidade+UF.
- **A resolução é assíncrona, no padrão da geocodificação já existente** (`apps/api/src/geo/geocodificacao.worker.ts`, migração 023): grava o que tiver na hora, um worker diário completa o resto com contagem de tentativas. Isso tolera o ViaCEP fora do ar, cobre CEP genérico de cidade pequena e faz o backfill de toda a base já cadastrada sem trabalho extra.
- **O Dlinks pode mandar a IE, mas nunca apagá-la.** Campo opcional de entrada, gravado com `coalesce`.
- **O operador lê esses dados numa Ficha na Retaguarda**, com copiar por campo, para digitar no ERP.

Risco aceito: a IE não é validada de verdade — só o formato (8–14 dígitos). Cada UF tem sua própria regra de dígito verificador e a lista completa não compensa manter. Uma IE digitada errada só é descoberta no ERP. Validação por UF fica fora de escopo.

## Banco (migração tenant `028_ie_e_municipio.sql`)

```sql
alter table clientes
  add column if not exists inscricao_estadual text;

alter table cliente_enderecos
  add column if not exists codigo_municipio              text,
  add column if not exists municipio_tentativas          int not null default 0,
  add column if not exists municipio_ultima_tentativa_em timestamptz;

create index if not exists cliente_enderecos_municipio_pendente_idx
  on cliente_enderecos (municipio_tentativas) where codigo_municipio is null;
```

A IE fica em `clientes` porque é atributo do CNPJ, não do endereço. O código do município fica em `cliente_enderecos` porque é atributo do endereço — um cliente com dois endereços pode ter dois municípios.

Todas as colunas são nullable: nenhuma linha existente quebra na migração.

Espelhar em `11 - SQL/` (fora do repo) como as demais migrações.

## App (`apps/mobile/lib/features/auth/cadastro_screen.dart`)

**Inscrição Estadual**, logo abaixo de "Razão social", renderizada apenas quando `_tipo == 'CNPJ'` (mesmo bloco condicional `if (ehCnpj)` que já existe):

- `TextFormField` "Inscrição Estadual", teclado numérico.
- `CheckboxListTile` "Isento de Inscrição Estadual". Marcado, o campo fica desabilitado e o texto é limpo.
- Validação: se `ehCnpj` e não isento, exige 8 a 14 dígitos (após remover não-dígitos); senão, `null`.
- Trocar de CNPJ para CPF limpa a IE e desmarca o isento, para o payload nunca sair com IE de um CPF.

**Código do município**, sem nenhum campo visível:

- `_buscarCep` passa a guardar `d['ibge']` num `String? _codigoMunicipio` do state (hoje o valor é ignorado).
- `_codigoMunicipio` é zerado sempre que o CEP muda, para não carregar o município do CEP anterior quando o cliente corrige o CEP.

**Payload de `/auth/registrar`** ganha:

```
'inscricaoEstadual': <IE só dígitos>   // ausente quando isento ou CPF
'isentoIe': true                        // ausente quando não isento
'endereco': { ..., 'codigoMunicipio': <ibge> }  // ausente quando não veio do ViaCEP
```

## API — cadastro

`RegistrarDto` (`apps/api/src/auth/auth.controller.ts`):

```ts
@IsOptional() @IsString() inscricaoEstadual?: string;
@IsOptional() @IsBoolean() isentoIe?: boolean;
```

`EnderecoCadastroDto`:

```ts
@IsOptional() @IsString() codigoMunicipio?: string;
```

`auth.service.registrar`:

- Se `tipo === 'CNPJ'` e não houver `isentoIe === true` nem `inscricaoEstadual` preenchida → `BadRequestException('Informe a Inscrição Estadual ou marque Isento')`. A validação do app não basta: a API é endpoint público.
- Grava `inscricao_estadual` como `'ISENTO'` quando isento, senão a IE só com dígitos, senão `null` (CPF).
- Grava `codigo_municipio` no insert de `cliente_enderecos` quando veio; `null` quando não.

## API — worker de município

Arquivo novo `apps/api/src/municipios/municipios.worker.ts`, espelhando `GeocodificacaoWorker`: `setInterval` de 60s dentro da própria API, sem fila externa, com `deveRodarAgora(agora, ultimaDataRodada)` como função pura testável.

- Horário: hora 04. O `deveRodarAgora` da geocodificação tem granularidade de hora (`agora.getHours() !== HORA_AGENDADA`), então marcar 03:20 faria os dois workers caírem na mesma hora e disputarem rede. Usar `HORA_AGENDADA = 4` mantém a função pura idêntica à existente e separa de verdade.
- Seleciona endereços de todos os tenants com `codigo_municipio is null` e `municipio_tentativas < 5`, em lotes de 200.
- Resolve por `GET https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios`, casando `nome` com `cidade` após normalizar (minúsculas, sem acento, sem pontuação). A lista de cada UF é buscada uma vez por execução e reaproveitada — são 27 requisições no total, não uma por endereço.
- Ritmo de 1 req/s, como a geocodificação.
- Sem correspondência: incrementa `municipio_tentativas`, grava `municipio_ultima_tentativa_em`, segue. Após 5 tentativas o endereço para de ser tentado e aparece na Ficha como pendente.
- **Nunca escreve no ERP.** Só em `cliente_enderecos`.
- Desligável por `MUNICIPIOS_DESLIGADO=true`, como `GEOCODIFICACAO_DESLIGADA`.

Este worker é o que faz o backfill: na primeira execução ele percorre todos os endereços já existentes, inclusive os que vieram do Dlinks.

## API — entrada do Dlinks

`ClienteDto` (`apps/api/src/integracoes-dlinks/cliente.dto.ts`):

```ts
/** Inscrição Estadual do cliente no ERP. Opcional. */
@IsOptional() @IsString() inscricao_estadual?: string;
```

No `syncClientes`, dentro do `on conflict (documento) do update set`:

```sql
inscricao_estadual = coalesce(excluded.inscricao_estadual, clientes.inscricao_estadual)
```

O `coalesce` é o ponto importante: o Dlinks preenche a IE de quem ainda não tem, mas uma sincronização sem o campo **nunca apaga** a IE que o cliente digitou no app. Mesma política já usada para `email`.

Nada mais no contrato do Dlinks muda: nenhum endpoint novo, nenhum campo obrigatório novo, nenhuma quebra para o lado deles se continuarem enviando exatamente o payload de hoje.

**Documentação externa:** registrar `inscricao_estadual` como campo opcional de `POST /integracoes/dlinks/clientes` em `01 - Documentação/03-INTEGRACAO-DLINKS-HANDOFF.html` (e regerar o PDF), seguindo o padrão dos backups datados já existentes na pasta.

## Retaguarda — Ficha do cliente

`GET /admin/clientes/:id/ficha` devolve tipo, documento, razão social, nome fantasia, inscrição estadual, e o endereço padrão com CEP, logradouro, número, complemento, bairro, cidade, UF e código do município.

`apps/admin/src/paginas/Clientes.tsx`: botão `Ficha` na coluna Ações abre um modal com dois blocos — DADOS FISCAIS e ENDEREÇO — cada campo com botão de copiar. A tabela não ganha coluna nenhuma: ela já tem 8 e passaria a rolar na horizontal.

Exibição do código do município: `2611606 · Recife/PE`. Enquanto o worker não resolveu, `— (buscando)` em vez de campo vazio, para o operador saber que é pendência e não ausência de dado. IE ausente (cliente do Dlinks que nunca enviou) aparece como `—`.

Seguir o padrão visual da Retaguarda já existente; botões de ação acima do conteúdo, nunca em rodapé.

## Testes

Seguindo o padrão do repositório (`*.spec.ts` na API, `widget_test.dart` no app):

- `municipios.worker.spec.ts` — `deveRodarAgora` como função pura: roda na hora certa, não roda duas vezes no mesmo dia. Normalização de nome de município casando "Sao Paulo" com "São Paulo".
- `auth.service` — CNPJ sem IE e sem isento é rejeitado; CNPJ isento grava `ISENTO`; CPF com IE no payload grava `null`.
- `dlinks-sync.service` — sincronização sem `inscricao_estadual` não apaga a IE já gravada; com o campo, preenche quem estava sem.
- `widget_test.dart` — o campo IE e o checkbox não aparecem no modo CPF.

## Fora de escopo

- IE na tela de edição de endereço/perfil do app. Só o cadastro inicial coleta.
- Envio automático do cliente novo do app para o ERP. A integração hoje é só ERP → app; criar o caminho de saída é projeto próprio, com contrato a negociar.
- Validação de Inscrição Estadual por UF (dígito verificador).
- Código do município em endereços adicionais cadastrados depois pelo cliente — o worker os cobre naturalmente, mas nenhuma tela os exibe.
