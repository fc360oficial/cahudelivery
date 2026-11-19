# Integração Dlinks × Fluxo Commerce — referência da API

Versão de 17/11/2026, conferida rota por rota contra o código em produção (`apps/api/src/integracoes-dlinks`).
Substitui as versões anteriores do documento de integração (`03-INTEGRACAO-DLINKS-HANDOFF`).

## O que mudou nesta versão

- **Rota nova `POST /notas-entrega`** (Fluxo Entregas): notas faturadas dos pedidos digitados direto no ERP (televendas), para entrarem nas cargas dos caminhões. Ver a seção 6.
- **Correção**: `POST /pedidos-faturados` recebe **um pedido por chamada** (objeto). As outras rotas de envio aceitam um item ou uma lista.

## 1. Acesso

| Item | Valor |
|---|---|
| Endereço base | `https://cahudelivery.duckdns.org/v1/integracoes/dlinks` |
| Autenticação | header `apikey: <chave fornecida pela CAHU>` em todas as chamadas |
| Formato | `Content-Type: application/json`, UTF-8 |
| Tamanho máximo do XML | `xml_base64` com até 2.000.000 caracteres |

A chave identifica a distribuidora. Não é preciso enviar nenhum outro identificador.

## 2. Respostas e erros

| Código | Quando |
|---|---|
| `200` | Lote recebido. O resultado vem item a item (ver abaixo). Um item com problema não derruba os outros |
| `400` | Corpo fora do formato. A resposta lista o problema de cada item, com a posição: `"[3] chave da NF-e deve ter 44 dígitos"` e os campos que chegaram |
| `401` | `apikey` ausente (`Header apikey ausente`) ou inválida (`apikey inválida`) |

Resposta das rotas de cadastro (seções 3, 4 e 6):

```json
{ "processados": 120, "ignorados": [ { "item": { "produto_codigo": "123", "tabela_id": "6", "valor": 10.5 }, "motivo": "produto_nao_encontrado" } ] }
```

Resposta das rotas de pedido (seção 5):

```json
{ "processados": ["<codigo>"], "ignorados": [ { "codigo": "<codigo>", "motivo": "status_invalido" } ] }
```

Lista vazia (`[]`) é recusada com `400` (`lista vazia: envie ao menos um item`). Campos que não estão neste documento são descartados.

**Reenviar é seguro em todas as rotas**: o item é identificado pelo código do ERP (ou pela chave da nota) e o reenvio atualiza, nunca duplica.

## 3. Cadastros (ERP → Fluxo)

Ordem recomendada numa carga completa, porque cada etapa depende da anterior:
grupos, fornecedores e tabelas de preço → produtos → preços; formas → condições de pagamento; clientes → títulos.

### `POST /grupos`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo` | texto | sim |
| `descricao` | texto | sim |

### `POST /fornecedores`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo` | texto | sim |
| `razao_social` | texto | sim |

### `POST /tabelas-de-precos`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `id` | texto | sim (código da tabela no ERP) |
| `descricao` | texto | sim |

### `POST /produtos`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `codigo` | texto | sim | |
| `fornecedor_codigo` | texto | sim | o mesmo de `/fornecedores` |
| `grupo_codigo` | texto | sim | o mesmo de `/grupos` |
| `descricao` | texto | sim | |
| `unidade` | texto | sim | `UN`, `CX`, `FD`, `PC` ou `KG` |
| `multiplo_venda` | número | não | quantidade por embalagem; padrão 1 |
| `estoque` | número | não | **omitido = estoque zero** (o produto some do app) |
| `ativo` | sim/não | não | `false` tira o produto do app; omitido mantém como está (produto novo nasce ativo) |

### `POST /precos`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `produto_codigo` | texto | sim |
| `tabela_id` | texto | sim, não pode ser vazio (o `id` de `/tabelas-de-precos`) |
| `valor` | número | sim (em reais) |
| `percentual_max_desconto` | número | não |
| `percentual_max_acrescimo` | número | não |

Ignorados: `produto_nao_encontrado`, `tabela_nao_encontrada`, `erro_ao_gravar: <detalhe>`.

### `POST /clientes`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `codigo` | texto | sim | código do cliente no ERP |
| `razao_social` | texto | sim | |
| `cnpj_cpf` | texto | sim | identifica o cliente (com ou sem pontuação) |
| `email` (ou `Email`) | e-mail válido | não | ausente não apaga o e-mail já gravado |
| `endereco` | objeto | sim | `logradouro`, `numero`, `bairro`, `cidade`, `uf`, `cep` obrigatórios; `complemento` opcional |
| `limite_credito` | número | não | |
| `saldo_titulos_aberto` | número | não | |
| `tabela_preco_id` | texto | não | ausente mantém a tabela atual do cliente |
| `inscricao_estadual` | texto | não | ausente não apaga a IE já gravada |

Regras: o cliente é identificado pelo CNPJ/CPF. Se ele já se cadastrou sozinho no app, o cadastro é atualizado, não duplicado. O endereço só é gravado na criação, para não apagar o que o cliente editou no app. Cliente novo ganha a senha provisória do app.

### `POST /formaspagamento`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo` | texto | sim |
| `descricao` | texto | sim |

### `POST /condicoespagamento`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo` | texto | sim |
| `descricao` | texto | sim |
| `forma_pagamento_codigo` | texto | sim |

Ignorado: `forma_pagamento_nao_encontrada`.

### `POST /titulos`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `numero_titulo` | texto | sim |
| `cliente_codigo` | texto | sim |
| `valor` | número | sim |
| `vencimento` | data (`AAAA-MM-DD`) | sim |
| `status` | texto | sim |

Ignorado: `cliente_nao_encontrado`.

## 4. Vendedores (Fluxo Vendas)

### `POST /funcionarios`

| Campo | Tipo | Obrigatório |
|---|---|---|
| `codigo` | texto | sim |
| `nome` | texto | sim |
| `filial_codigo` | texto | não |
| `ativo` | sim/não | não |

### `POST /clientes-funcionarios` (carteira)

| Campo | Tipo | Obrigatório |
|---|---|---|
| `cliente_codigo` | texto | sim |
| `funcionario_codigo` | texto ou `null` | sim (o campo tem de vir) |

Regras: **o lote manda nos clientes que cita**. Os vínculos antigos desses clientes são apagados e entram os do lote. Por isso **todos os vendedores de um cliente precisam vir na mesma chamada**. Cliente que não aparece no lote não é tocado. `funcionario_codigo` `null` ou vazio tira o cliente de todas as carteiras.

Ignorados: `cliente_nao_encontrado`, `funcionario_nao_encontrado`.

### `POST /vendas-vendedores` (faturado do mês, base da meta)

| Campo | Tipo | Obrigatório |
|---|---|---|
| `funcionario_codigo` | texto | sim |
| `ano_mes` | texto `AAAA-MM` | sim |
| `valor_faturado` | número ≥ 0, até 2 casas | sim (em reais) |

Um item por vendedor e mês. Reenviar o mês corrige o valor. Ignorado: `funcionario_nao_encontrado`.

### `POST /devolucoes`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `numero_nota` | texto | sim | com `serie`, identifica a devolução |
| `serie` | texto | não | |
| `data` | data | sim | o mês desta data sofre o desconto |
| `valor` | número ≥ 0, até 2 casas | sim | total da nota de devolução, em reais |
| `pedido_codigo` | texto | um dos dois | o mesmo código de `/pedidos-faturados` |
| `funcionario_codigo` | texto | um dos dois | quando a venda não nasceu no app |
| `cliente_codigo` | texto | não | |
| `nota_venda_numero` | texto | não | informativo |
| `cancelada` | sim/não | não | `true` = estornada no ERP, deixa de descontar |

Ignorados: `pedido_nao_encontrado`, `pedido_sem_vendedor`, `sem_pedido_nem_funcionario`, `funcionario_nao_encontrado`.

## 5. Pedidos do app, do site e do Fluxo Vendas (Fluxo → ERP → Fluxo)

### `GET /pedidos?data_inicial=AAAA-MM-DD&data_final=AAAA-MM-DD`

Pedidos criados no período (horário de Recife), inclusive o dia final. Não traz pedido aguardando pagamento online nem pedido retido aguardando o vendedor.

```json
{
  "pedidos": [
    {
      "codigo": "<uuid>",
      "numero": 1234,
      "criadoEm": "2026-11-17T11:02:00.000Z",
      "origem": "app_cliente",
      "cliente": { "codigo": "4521", "documento": "12345678000199", "tipo": "CNPJ", "razaoSocial": "...", "nomeFantasia": "...", "email": null, "telefone": "81...", "erpClienteId": "4521" },
      "tipoEntrega": "entrega",
      "endereco": { "...": "endereço de entrega escolhido no pedido" },
      "formaPagamento": "boleto",
      "condicaoPagamento": null,
      "itens": [ { "erpProdutoId": "123", "quantidade": 2, "precoUnit": 10.5 } ],
      "valorAbatidoSaldo": 0,
      "pagamentoOnline": { "status": "pago", "pagoEm": "...", "txid": "...", "valor": 21.0 },
      "vendedor": { "codigo": "17", "nome": "..." },
      "tabelaPreco": { "codigo": "6", "nome": "..." },
      "formaPagamentoCodigo": "3"
    }
  ]
}
```

- `origem`: `app_cliente` (aplicativo e site) ou `vendedor` (Fluxo Vendas).
- `pagamentoOnline` só aparece quando o pedido foi pago ou pré-autorizado no app. Com `status: "autorizado"` (cartão com valor reservado), **o ERP não deve gerar cobrança**: a CAHU captura o valor da NF-e no faturamento.
- `vendedor`, `tabelaPreco` e `formaPagamentoCodigo` só aparecem quando existem (pedido do Fluxo Vendas).
- `cliente.codigo` é `null` se o cliente ainda não foi enviado em `/clientes`.

### `POST /pedidos/recebido` e `POST /pedidos/cancelado`

```json
{ "codigos": ["<uuid>", "<uuid>"] }
```

Até 500 códigos por chamada (os `codigo` de `GET /pedidos`). Aqui o corpo é sempre esse objeto, nunca uma lista.

- `recebido`: só vale para pedido ainda não confirmado pelo ERP.
- `cancelado`: vale até o pedido ser entregue. Devolve ao cliente o saldo que ele usou.

Ignorados: `nao_encontrado`, `status_invalido`, `erro_interno`.

### `POST /pedidos-faturados`

**Um pedido por chamada** (objeto, não lista).

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `pedido_codigo` | texto | sim | o `codigo` de `GET /pedidos` |
| `status` | texto | sim | `ABERTO`, `EM_FATURAMENTO`, `FATURADO` ou `CANCELADO` |
| `valores.subtotal` | número | sim, se mandar `valores` | **em centavos** |
| `valores.desconto` | número | não | **em centavos** |
| `valores.total` | número | sim, se mandar `valores` | **em centavos** |
| `itens[]` | lista | não | `produto_codigo`, `quantidade`, `valor_unitario` (**em reais**) |
| `nota_fiscal.chave` | 44 dígitos | sim, se mandar a nota | |
| `nota_fiscal.numero` / `serie` | texto | sim, se mandar a nota | |
| `nota_fiscal.emitida_em` | data e hora | não | |
| `nota_fiscal.xml_base64` | texto | sim, se mandar a nota | XML da NF-e em base64 |

Regras:
- `ABERTO` e `EM_FATURAMENTO` podem reabrir um pedido já faturado (nova carga no ERP). Nada muda pedido entregue ou cancelado.
- `CANCELADO` faz o mesmo que `/pedidos/cancelado`.
- Pedido sem NF-e emitida (cancelado antes de faturar, por exemplo): não mande `nota_fiscal`, ou mande o bloco vazio (`"nota_fiscal": {}`). Os dois valem como "sem nota". Bloco preenchido pela metade devolve `400`.
- Reenviar `FATURADO` não muda o status, mas grava a nota e os valores (serve para mandar a NF-e depois).
- Nota com XML ilegível ou com chave diferente da que está no XML é recusada com `400` antes de o status mudar.

## 6. Notas de entrega do televendas (Fluxo Entregas) — NOVO

### `POST /notas-entrega`

O módulo Entregas monta as cargas dos caminhões, imprime o romaneio e acompanha a entrega pelo app do motorista. Os pedidos do app, do site e do Fluxo Vendas já chegam por `/pedidos-faturados`. Esta rota é para os pedidos **digitados direto no ERP (televendas)**.

**Quando enviar**
- No faturamento de todo pedido que **não nasceu no Fluxo Commerce**.
- De novo, com `"status": "CANCELADO"`, se a nota for cancelada depois.
- A chave de acesso identifica a nota: o reenvio corrige, não duplica.
- Nota de pedido do app, do site ou do Fluxo Vendas não precisa vir por aqui. Se vier, é ignorada com `nota_de_pedido_do_fluxo`.

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `nota_fiscal.chave` | 44 dígitos | sim | |
| `nota_fiscal.numero` | texto | sim | |
| `nota_fiscal.serie` | texto | sim | |
| `nota_fiscal.xml_base64` | texto | sim no faturamento | igual ao de `/pedidos-faturados`; pode faltar só no cancelamento |
| `nota_fiscal.emitida_em` | data e hora | não | sem ele, vale a do XML |
| `pedido_numero` | texto (até 60) | não | número do pedido no ERP; aparece nas telas e no romaneio |
| `cliente_codigo` | texto | não | o mesmo de `/clientes` |
| `tipo_entrega` | texto | não | `entrega` (padrão) ou `retirada`; retirada fica registrada, mas não entra em carga |
| `origem` | texto (até 40) | não | quem digitou o pedido; padrão `televendas` |
| `status` | texto | não | `FATURADO` (padrão) ou `CANCELADO` |

**Não é preciso enviar valores, itens, volumes, peso nem endereço.** Tudo é lido do XML: total (`vNF`), itens (`det`), volumes e peso bruto (`transp/vol`, quando a nota informa) e nome, documento e endereço do destinatário (`dest`).

Exemplo de faturamento (aceita um item ou uma lista):

```json
[
  {
    "pedido_numero": "123456",
    "origem": "televendas",
    "cliente_codigo": "4521",
    "tipo_entrega": "entrega",
    "status": "FATURADO",
    "nota_fiscal": {
      "chave": "26260961920643000148550030000050601000073367",
      "numero": "5060",
      "serie": "3",
      "emitida_em": "2026-11-17T08:10:00-03:00",
      "xml_base64": "PD94bWwgdmVyc2lvbj0i..."
    }
  }
]
```

Exemplo de cancelamento:

```json
{ "status": "CANCELADO", "nota_fiscal": { "chave": "26260961920643000148550030000050601000073367", "numero": "5060", "serie": "3" } }
```

| Ignorado com o motivo | O que aconteceu |
|---|---|
| `nota_de_pedido_do_fluxo` | a nota é de um pedido do app, do site ou do Fluxo Vendas e já chegou por `/pedidos-faturados` |
| `xml_ausente` | faturamento sem `xml_base64` |
| `xml_invalido` | o `xml_base64` não é uma NF-e que conseguimos ler |
| `chave_divergente` | a `chave` enviada é diferente da que está no XML |
| `nota_nao_encontrada` | cancelamento sem XML de uma nota que nunca recebemos |

`400` quando falta `nota_fiscal`, a chave não tem 44 dígitos ou `tipo_entrega`/`status` têm valor desconhecido.

## 7. A combinar com o Dlinks

1. Prazo para começar a enviar `/notas-entrega` em teste.
2. Conseguem informar `tipo_entrega` (entrega ou retirada) nos pedidos do televendas?
3. Quando o endereço de entrega não for o do destinatário, a NF-e leva o grupo `<entrega>` (local de entrega)?
4. A nota pode sair com volumes e peso bruto preenchidos (`transp/vol`)? Hoje as notas chegam sem esse bloco, e o peso da carga fica só estimado.
