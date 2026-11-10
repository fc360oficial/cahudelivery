import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar } from './conferir-pedido';

export interface ResumoVendedor {
  vendidoHoje: number;
  pedidosHoje: number;
  ticketMedioHoje: number;
  vendidoMes: number;
  clientesCarteira: number;
  clientesPositivadosMes: number;
  pedidosRetidos: number;
  orcamentosAbertos: number;
}

/** "Hoje" e "mês" no fuso de Recife. Pedido cancelado, retido ou aguardando pagamento não conta como venda. */
@Injectable()
export class VendasResumoService {
  async resumo(vendedorId: string): Promise<ResumoVendedor> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `with v as (
         select p.cliente_id, p.total,
                (p.criado_em at time zone 'America/Recife')::date as dia
           from pedidos p
          where p.vendedor_id = $1
            and p.status not in ('CANCELADO','AGUARDANDO_VENDEDOR','AGUARDANDO_PAGAMENTO')
            and p.criado_em >= date_trunc('month', now() at time zone 'America/Recife') at time zone 'America/Recife'
       ), hoje as (select (now() at time zone 'America/Recife')::date as d)
       select
         (select coalesce(sum(total),0) from v, hoje where v.dia = hoje.d) as vendido_hoje,
         (select count(*)::int from v, hoje where v.dia = hoje.d) as pedidos_hoje,
         (select coalesce(sum(total),0) from v) as vendido_mes,
         (select count(*)::int from cliente_vendedor where vendedor_id = $1) as carteira,
         (select count(distinct v.cliente_id)::int from v join cliente_vendedor cv on cv.cliente_id = v.cliente_id and cv.vendedor_id = $1) as positivados,
         (select count(*)::int from pedidos where vendedor_id = $1 and status = 'AGUARDANDO_VENDEDOR') as retidos,
         (select count(*)::int from orcamentos where vendedor_id = $1 and status = 'aberto') as orcamentos`,
      [vendedorId],
    );
    const r = rows[0];
    const vendidoHoje = Number(r.vendido_hoje);
    const pedidosHoje = Number(r.pedidos_hoje);
    return {
      vendidoHoje,
      pedidosHoje,
      ticketMedioHoje: pedidosHoje ? arredondar(vendidoHoje / pedidosHoje) : 0,
      vendidoMes: Number(r.vendido_mes),
      clientesCarteira: Number(r.carteira),
      clientesPositivadosMes: Number(r.positivados),
      pedidosRetidos: Number(r.retidos),
      orcamentosAbertos: Number(r.orcamentos),
    };
  }
}
