/**
 * Origem de pedido feito pelo próprio cliente, sem vendedor: app (Delivery) ou site.
 * O pedido do site se comporta como o do app em tudo (lista, relatórios, mais
 * vendidos, indicação, retaguarda); nas consultas o filtro é
 * `origem in ('app_cliente','site')`.
 */
export type OrigemPedidoCliente = 'app_cliente' | 'site';

/**
 * Cabeçalho X-Canal do POST pedidos: só o valor exato 'site' muda algo. Ausente,
 * vazio ou qualquer outro valor é o app (comportamento de sempre), sem erro.
 */
export function origemDoCanal(canal: unknown): OrigemPedidoCliente {
  return canal === 'site' ? 'site' : 'app_cliente';
}

/**
 * Contratos de fora (Dlinks/ERP e app do vendedor) só conhecem app_cliente e
 * vendedor: pedido do site sai para eles como app_cliente.
 */
export function origemParaContrato(origem: string): 'app_cliente' | 'vendedor' {
  return (origem === 'site' ? 'app_cliente' : origem) as 'app_cliente' | 'vendedor';
}
