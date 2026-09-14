-- Forma de pagamento 'cartao' (crédito/débito na maquininha, na entrega).
-- Não há gateway online ainda (aguardando definição Itaú/Rede) — o pedido só
-- registra a forma escolhida; o ERP não gera cobrança pra 'cartao'.
alter table pedidos drop constraint if exists pedidos_forma_pagamento_check;
alter table pedidos add constraint pedidos_forma_pagamento_check
  check (forma_pagamento in ('boleto','pix','cartao'));

-- Lançamento do CAHU Delivery: só PIX e Cartão. Boleto fica desligado
-- (pode ser religado em Configurações > Formas de pagamento aceitas).
update configuracoes set valor_json = '["pix","cartao"]' where chave = 'formas_pagamento';
