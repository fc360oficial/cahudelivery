# Integração Dlinks — Notas de entrega (Fluxo Entregas)

Seção nova do documento de integração (`03-INTEGRACAO-DLINKS-HANDOFF`). Vale a partir da publicação do módulo Entregas.

## Para que serve

O módulo Entregas monta as cargas dos caminhões, imprime o romaneio e acompanha a entrega pelo aplicativo do motorista. Os pedidos feitos pelo aplicativo, pelo site e pelo Fluxo Vendas já chegam faturados por `/pedidos-faturados`. Faltam os pedidos **digitados direto no ERP (televendas)**: é para eles que esta rota existe.

## Rota

```
POST https://cahudelivery.duckdns.org/v1/integracoes/dlinks/notas-entrega
Header: apikey: <a mesma chave das outras rotas>
Content-Type: application/json
```

Aceita um item ou uma lista. (Atenção: `/pedidos-faturados` é diferente e recebe um pedido por chamada.) Referência completa de todas as rotas: `docs/integracao-dlinks-api.md`.

## Quando enviar

- No **faturamento** de todo pedido que **não nasceu no Fluxo Commerce**.
- De novo, com `"status": "CANCELADO"`, se a nota for cancelada depois.
- Reenviar a mesma nota não duplica: a chave de acesso identifica a nota e o reenvio corrige os dados.

Nota de pedido do aplicativo, do site ou do Fluxo Vendas não precisa vir por aqui. Se vier, é ignorada com o motivo `nota_de_pedido_do_fluxo`.

## Corpo

| Campo | Obrigatório | O que é |
|---|---|---|
| `nota_fiscal.chave` | sim | Chave de acesso da NF-e, 44 dígitos |
| `nota_fiscal.numero` | sim | Número da nota (texto) |
| `nota_fiscal.serie` | sim | Série (texto) |
| `nota_fiscal.xml_base64` | sim no faturamento | XML da NF-e em base64, igual ao de `/pedidos-faturados`. Pode faltar só no cancelamento |
| `nota_fiscal.emitida_em` | não | Data e hora da emissão. Sem ele, usamos a do XML |
| `pedido_numero` | não | Número do pedido no Dlinks. Aparece nas telas e no romaneio |
| `cliente_codigo` | não | O mesmo código enviado em `/clientes` |
| `tipo_entrega` | não | `"entrega"` (padrão) ou `"retirada"`. Retirada fica registrada, mas não entra em carga |
| `origem` | não | Quem digitou o pedido. Padrão `"televendas"` |
| `status` | não | `"FATURADO"` (padrão) ou `"CANCELADO"` |

**Não é preciso enviar valores, itens, volumes, peso nem endereço.** Tudo isso é lido do XML da nota: total (`vNF`), itens (`det`), volumes e peso bruto (`transp/vol`, quando a nota informa) e nome, documento e endereço do destinatário (`dest`).

### Exemplo: faturamento

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

### Exemplo: cancelamento

```json
{
  "status": "CANCELADO",
  "nota_fiscal": { "chave": "26260961920643000148550030000050601000073367", "numero": "5060", "serie": "3" }
}
```

## Resposta

Sempre `200`, com o resultado nota a nota. Um problema numa nota não derruba as outras do lote.

```json
{ "processados": 1, "ignorados": [ { "item": { "chave": "...", "numero": "5061", "serie": "3", "pedido_numero": "123457", "status": "FATURADO" }, "motivo": "xml_invalido" } ] }
```

| Motivo | O que aconteceu |
|---|---|
| `nota_de_pedido_do_fluxo` | A nota é de um pedido do aplicativo, site ou Fluxo Vendas e já chegou por `/pedidos-faturados` |
| `xml_ausente` | Faturamento sem `xml_base64` |
| `xml_invalido` | O `xml_base64` não é uma NF-e que conseguimos ler |
| `chave_divergente` | A `chave` enviada é diferente da chave que está dentro do XML |
| `nota_nao_encontrada` | Cancelamento sem XML de uma nota que nunca recebemos |

`400` só quando o corpo está fora do formato (sem `nota_fiscal`, chave sem 44 dígitos, `tipo_entrega` ou `status` desconhecidos). `401` quando a `apikey` falta ou é inválida.

## A combinar com o Dlinks

1. Conseguem informar `tipo_entrega` (entrega ou retirada) nesses pedidos?
2. O endereço de entrega é sempre o do destinatário da nota? Quando for outro, a NF-e leva o grupo `<entrega>` (local de entrega)?
3. A nota pode sair com volumes e peso bruto preenchidos (`transp/vol`)? Hoje as notas chegam sem esse bloco.
4. Prazo para começar a enviar em teste.
