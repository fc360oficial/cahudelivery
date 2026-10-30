# Políticas do app — versão publicada em 23/10/2026

**Revisão de 30/10/2026 (ainda NÃO publicada no app):** a política de cancelamento ganhou
"Pedido que saiu e não foi entregue", "Confirmação do recebimento" (canhoto assinado),
"Segurança do pagamento com cartão" (3DS, PIX para primeiros pedidos/valores altos,
falar com a distribuidora antes de contestar) e a devolução da diferença quando o
faturado é menor que o pago. PIX passa a voltar como crédito na carteira do app
(automático); dinheiro de volta só se o cliente pedir. Cartão continua sempre estornado
no cartão (crédito no lugar do estorno provoca chargeback).

**Quando a pré-autorização do cartão for ligada** (chave `preAutorizacao` no provedor erede,
depois que a Rede confirmar liberação no PV, prazo de captura e captura parcial), trocar o
parágrafo "Cartão de crédito:" de REEMBOLSO por:

> Cartão de crédito: na compra, o valor do pedido fica apenas reservado no limite do cartão. A cobrança é feita pelo valor da nota fiscal, no faturamento — item em falta não é cobrado. Se o pedido for cancelado antes do faturamento, a reserva é liberada e nada aparece na fatura. Depois da cobrança, cancelamentos e diferenças são estornados no mesmo cartão: o estorno é solicitado à administradora em até 2 dias úteis e o valor volta na fatura conforme o prazo do banco emissor, em geral em até 2 faturas. Publicar = colar o texto abaixo em Configurações › Políticas
do app. Cada pedido grava o hash do texto vigente (`pedidos.aceite_json`), então a
versão aceita fica registrada pra uma contestação.

Textos gravados nas configurações do tenant `cahu` (chaves `politica_cancelamento` e
`politica_privacidade`). O app mostra as duas no Perfil e o link de cancelamento na tela
do cartão. Edição pela retaguarda: Configurações › Políticas do app (texto puro, sem
formatação — o app exibe como está).

Prazos adotados (padrão de mercado, Tiago confirma): estorno de cartão solicitado em até
2 dias úteis; devolução PIX em até 2 dias úteis; avaria comunicada em até 48 h.
Contato (WhatsApp / e-mail / endereço) está escrito como "canais informados no app":
quando a Cahu definir o WhatsApp oficial do delivery, preencher em Configurações ›
WhatsApp da distribuidora e trocar o rodapé dos dois textos pelo número.

---

## Trocas, cancelamento e reembolso (`politica_cancelamento`)

CAHU DISTRIBUIDORA DE ALIMENTOS LTDA — CNPJ 61.920.643/0001-48

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

Última atualização: 30/10/2026

---

## Política de privacidade (`politica_privacidade`)

CAHU DISTRIBUIDORA DE ALIMENTOS LTDA — CNPJ 61.920.643/0001-48 ("nós")

Esta política explica quais dados coletamos no app CAHU Delivery, para que usamos e quais são os seus direitos, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).

O QUE COLETAMOS

Dados cadastrais: razão social ou nome, CNPJ ou CPF, e-mail, telefone/WhatsApp e endereços de entrega. Servem para cadastro, faturamento e entrega dos pedidos.

Dados de pedidos: itens, valores, notas fiscais e histórico de compras. Servem para executar a compra e venda e cumprir obrigações fiscais.

Pagamento: os dados do cartão são enviados diretamente à processadora de pagamentos (Rede S.A., do grupo Itaú) e não ficam armazenados no app nem em nossos servidores. Do PIX, guardamos apenas a confirmação do pagamento.

Dados técnicos: identificação do aparelho e registros de acesso, usados para segurança e prevenção a fraudes.

PARA QUE USAMOS

Processar e entregar pedidos, emitir notas fiscais, processar pagamentos e estornos, dar suporte, prevenir fraudes, enviar avisos sobre seus pedidos e cumprir obrigações legais.

Não vendemos seus dados. Compartilhamos apenas com quem é necessário para operar: processadora de pagamentos (Rede/Itaú), sistema de gestão (ERP), transportadores das entregas e autoridades fiscais, quando exigido por lei.

POR QUANTO TEMPO

Pelo tempo da relação comercial e pelos prazos legais (documentos fiscais: 5 anos). Depois disso, os dados são excluídos ou anonimizados.

SEUS DIREITOS

Você pode solicitar a qualquer momento: confirmação de que tratamos seus dados, acesso, correção, exclusão, portabilidade e revogação de consentimento. Basta pedir pelos canais de atendimento informados no app. Dados necessários a obrigações legais (por exemplo, notas fiscais) são mantidos pelo prazo exigido em lei mesmo após o pedido de exclusão.

SEGURANÇA

Usamos conexão criptografada (HTTPS) em todo o app, controle de acesso aos sistemas e armazenamento em servidor próprio com cópia de segurança diária. Em caso de incidente de segurança relevante, os afetados e a Autoridade Nacional de Proteção de Dados serão comunicados.

ALTERAÇÕES

Esta política pode ser atualizada. A versão vigente fica sempre disponível no Perfil do app, com a data da última atualização.

Última atualização: 23/10/2026
