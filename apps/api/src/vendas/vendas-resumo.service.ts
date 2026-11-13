import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { arredondar } from './conferir-pedido';
import {
  calcularMeta,
  cteDevolucoes,
  cteVendasFaturadas,
  escolherBaseMeta,
  lerPercentualMeta,
} from './admin-vendas-util';

export interface ResumoVendedor {
  /** Faturado hoje (pedidos que o ERP faturou, pela data do faturamento). */
  vendidoHoje: number;
  /** Pedidos feitos e liberados hoje (contagem de pedidos, não de faturamento). */
  pedidosHoje: number;
  /** Faturado hoje ÷ pedidos faturados hoje. */
  ticketMedioHoje: number;
  /** Venda líquida do mês: faturado no mês menos as devoluções que entraram no mês. É sobre ela que a meta é medida. */
  vendidoMes: number;
  /** Faturado no mês, antes de descontar devoluções. */
  faturadoMes: number;
  /** Devoluções que entraram no mês (abatidas de vendidoMes). */
  devolvidoMes: number;
  /** Pedidos feitos e liberados no mês. */
  pedidosMes: number;
  /** Pedidos faturados no mês. */
  pedidosFaturadosMes: number;
  clientesCarteira: number;
  clientesPositivadosMes: number;
  pedidosRetidos: number;
  orcamentosAbertos: number;
  /** Meta do mês: base do mês anterior × (1 + percentual/100). Sem base, metaMes/atingidoPct/faltam são null. */
  meta: {
    percentual: number;
    vendidoMesAnterior: number;
    origemBase: 'erp' | 'pedidos' | null;
    metaMes: number | null;
    atingidoPct: number | null;
    faltam: number | null;
  };
}

/**
 * "Hoje" e "mês" no fuso de Recife. Vendido = faturado pelo ERP (ver cteVendasFaturadas).
 * No mês, o vendido é LÍQUIDO: desconta as devoluções que entraram no mês (cteDevolucoes). O do dia é o faturado do dia.
 * Contagens de pedido: cancelado, retido ou aguardando pagamento não contam.
 */
@Injectable()
export class VendasResumoService {
  async resumo(vendedorId: string): Promise<ResumoVendedor> {
    const { pool } = tenantCtx();
    const mesIni = `date_trunc('month', now() at time zone 'America/Recife') at time zone 'America/Recife'`;
    const [{ rows }, metaRes] = await Promise.all([
      pool.query(
        `with v as (
           select p.cliente_id, p.total,
                  (p.criado_em at time zone 'America/Recife')::date as dia
             from pedidos p
            where p.vendedor_id = $1
              and p.status not in ('CANCELADO','AGUARDANDO_VENDEDOR','AGUARDANDO_PAGAMENTO')
              and p.criado_em >= ${mesIni}
         ), ${cteVendasFaturadas('vf', 'p.vendedor_id = $1')},
         fm as (
           select valor, (data at time zone 'America/Recife')::date as dia
             from vf
            where data >= ${mesIni}
         ), ${cteDevolucoes('dv', 'd.vendedor_id = $1')},
         hoje as (select (now() at time zone 'America/Recife')::date as d)
         select
           (select coalesce(sum(valor),0) from fm, hoje where fm.dia = hoje.d) as vendido_hoje,
           (select count(*)::int from fm, hoje where fm.dia = hoje.d) as faturados_hoje,
           (select count(*)::int from v, hoje where v.dia = hoje.d) as pedidos_hoje,
           (select coalesce(sum(valor),0) from fm) as vendido_mes,
           (select coalesce(sum(valor),0) from dv where data >= ${mesIni}) as devolvido_mes,
           (select count(*)::int from fm) as faturados_mes,
           (select count(*)::int from v) as pedidos_mes,
           (select count(*)::int from cliente_vendedor where vendedor_id = $1) as carteira,
           (select count(distinct v.cliente_id)::int from v join cliente_vendedor cv on cv.cliente_id = v.cliente_id and cv.vendedor_id = $1) as positivados,
           (select count(*)::int from pedidos where vendedor_id = $1 and status = 'AGUARDANDO_VENDEDOR') as retidos,
           (select count(*)::int from orcamentos where vendedor_id = $1 and status = 'aberto') as orcamentos`,
        [vendedorId],
      ),
      pool.query(
        `/* meta */
         with ${cteVendasFaturadas('vf', 'p.vendedor_id = $1')}, ${cteDevolucoes('dv', 'd.vendedor_id = $1')}
         select (select coalesce(sum(valor), 0) from dv
                  where data >= (date_trunc('month', now() at time zone 'America/Recife') - interval '1 month') at time zone 'America/Recife'
                    and data <  date_trunc('month', now() at time zone 'America/Recife') at time zone 'America/Recife') as devolvido_anterior,
                (select coalesce(sum(valor), 0) from vf
                  where data >= (date_trunc('month', now() at time zone 'America/Recife') - interval '1 month') at time zone 'America/Recife'
                    and data <  date_trunc('month', now() at time zone 'America/Recife') at time zone 'America/Recife') as vendido_anterior,
                (select valor from vendedor_faturamento_mensal
                  where vendedor_id = $1
                    and ano_mes = to_char(date_trunc('month', now() at time zone 'America/Recife') - interval '1 month', 'YYYY-MM')) as erp_anterior,
                (select valor_json from configuracoes where chave = 'vendas_meta_percentual') as percentual`,
        [vendedorId],
      ),
    ]);
    const r = rows[0];
    const vendidoHoje = Number(r.vendido_hoje);
    const faturadosHoje = Number(r.faturados_hoje ?? 0);
    const faturadoMes = Number(r.vendido_mes);
    const devolvidoMes = Number(r.devolvido_mes ?? 0);
    const vendidoMes = arredondar(faturadoMes - devolvidoMes);
    const m = metaRes.rows[0] ?? {};
    const percentual = lerPercentualMeta(m.percentual);
    // Base própria = líquido do mês anterior. A do ERP já deve vir líquida de devoluções.
    const base = escolherBaseMeta(m.erp_anterior, Number(m.vendido_anterior ?? 0) - Number(m.devolvido_anterior ?? 0));
    return {
      vendidoHoje,
      pedidosHoje: Number(r.pedidos_hoje),
      ticketMedioHoje: faturadosHoje ? arredondar(vendidoHoje / faturadosHoje) : 0,
      vendidoMes,
      faturadoMes,
      devolvidoMes,
      pedidosMes: Number(r.pedidos_mes ?? 0),
      pedidosFaturadosMes: Number(r.faturados_mes ?? 0),
      clientesCarteira: Number(r.carteira),
      clientesPositivadosMes: Number(r.positivados),
      pedidosRetidos: Number(r.retidos),
      orcamentosAbertos: Number(r.orcamentos),
      meta: {
        percentual,
        vendidoMesAnterior: base.valor,
        origemBase: base.origem,
        ...calcularMeta(base.valor, vendidoMes, percentual),
      },
    };
  }
}
