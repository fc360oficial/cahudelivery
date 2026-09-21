-- O Dlinks passa a espelhar o status do ERP no pedido (ABERTO/EM_FATURAMENTO),
-- inclusive quando um pedido faturado é reaberto e recebe nova carga.
alter table pedidos drop constraint if exists pedidos_status_check;
alter table pedidos add constraint pedidos_status_check
  check (status in ('RECEBIDO','ENVIADO_ERP','ABERTO','EM_FATURAMENTO','FATURADO',
                    'EM_SEPARACAO','SAIU_ENTREGA','ENTREGUE','FALHA_INTEGRACAO','CANCELADO'));
