-- Publica a política de Trocas, cancelamento e reembolso revisada em 30/10/2026
-- (texto de docs/politicas.md). Banco do TENANT:
--   psql -U postgres -h 127.0.0.1 -d fluxo_t_cahu -f infra/scripts/politica-cancelamento-2026-10-30.sql
-- O app lê na abertura (GET /v1/config): quem já está com o app aberto vê ao reabrir.
-- Equivale a colar o texto em Retaguarda › Configurações › Políticas do app e salvar.
set client_encoding = 'UTF8';

insert into configuracoes (chave, valor_json) values ('politica_cancelamento', to_jsonb($POLITICA$CAHU DISTRIBUIDORA DE ALIMENTOS LTDA — CNPJ 61.920.643/0001-48

CANCELAMENTO DE PEDIDO

Pedidos pagos pelo app (PIX ou cartão de crédito) podem ser cancelados sem custo enquanto ainda não saíram para entrega. Para cancelar, fale com a distribuidora pelo WhatsApp (botão "Falar com a distribuidora", no app) dentro do horário de atendimento: segunda a sexta das 08:00 às 19:00 e sábado das 08:00 às 13:00.

Pedidos aguardando pagamento são cancelados automaticamente se o pagamento não for concluído em 30 minutos. Nesse caso nada é cobrado.

REEMBOLSO

Cartão de crédito: o estorno é solicitado à administradora do cartão em até 2 dias úteis após a confirmação do cancelamento. O valor volta na fatura conforme o prazo do banco emissor, em geral em até 2 faturas.

PIX: o valor pago vira crédito na sua carteira do app na hora do cancelamento, para usar no próximo pedido. Se preferir o dinheiro de volta, peça pelo WhatsApp e devolvemos para a conta de origem do pagamento em até 2 dias úteis (desde que o crédito ainda não tenha sido usado).

Se faturarmos menos do que foi pago (item em falta, por exemplo), a diferença é estornada no mesmo cartão (cartão de crédito) ou vira crédito na carteira do app (PIX), nas mesmas condições acima.

PEDIDO QUE SAIU E NÃO FOI ENTREGUE

Se o pedido saiu para entrega e não pôde ser entregue (estabelecimento fechado, endereço não localizado ou recusa no ato), fale com a distribuidora pelo WhatsApp: reagendamos a entrega sem custo ou cancelamos o pedido e devolvemos o valor integral como explicado em Reembolso, à sua escolha. Pedido não entregue nunca fica cobrado.

CONFIRMAÇÃO DO RECEBIMENTO

Na entrega, quem recebe informa nome e documento e assina o canhoto da nota fiscal. A assinatura confirma que a mercadoria foi recebida conforme a nota. Qualquer divergência deve ser anotada no canhoto ou comunicada em até 48 horas, como explicado abaixo.

SEGURANÇA DO PAGAMENTO COM CARTÃO

Seu banco pode pedir que você confirme a compra no aplicativo ou site dele antes da aprovação. Por segurança, pedidos acima de determinado valor e os primeiros pedidos de um cadastro podem ser aceitos só por PIX.

Antes de contestar uma compra com o banco do cartão, fale com a distribuidora: cancelamento e estorno feitos por nós são mais rápidos do que uma contestação.

TROCAS E DEVOLUÇÕES

Confira a mercadoria no ato da entrega. Produto com avaria, validade imprópria ou em desacordo com o pedido deve ser recusado na entrega ou comunicado em até 48 horas pelo WhatsApp, com foto do produto e da nota fiscal. Confirmada a divergência, fazemos a troca na próxima entrega ou o reembolso do item, à sua escolha.

Por segurança alimentar, produtos perecíveis fora das condições acima não são elegíveis a troca.

DIREITO DE ARREPENDIMENTO

Nos termos do art. 49 do Código de Defesa do Consumidor, quando aplicável, o cliente pode desistir da compra em até 7 dias corridos do recebimento, com devolução integral do valor pago, desde que os produtos sejam devolvidos nas condições em que foram entregues (perecíveis: lacrados e dentro das condições de conservação).

CONTATO

Fale com a distribuidora pelos canais informados no app (Perfil e botão "Falar com a distribuidora").

Última atualização: 30/10/2026$POLITICA$::text))
on conflict (chave) do update set valor_json = excluded.valor_json;

select left(valor_json #>> '{}', 60) as inicio, length(valor_json #>> '{}') as caracteres
  from configuracoes where chave = 'politica_cancelamento';
