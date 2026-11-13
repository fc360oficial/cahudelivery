import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import {
  addDias,
  calcularMeta,
  cteDevolucoes,
  cteVendasFaturadas,
  dinheiro,
  diasEntre,
  escolher,
  escolherBaseMeta,
  iso,
  lerPercentualMeta,
  n,
  pct1,
  SQL_STATUS_VENDA,
  uuidOpcional,
} from './admin-vendas-util';

export interface PainelParametros {
  periodo?: unknown;
  dias?: unknown;
  vendedorId?: unknown;
}

const PERIODOS = ['hoje', 'semana', 'mes'] as const;

/** Meia-noite (fuso de Recife) da data que vem no parâmetro $n. */
const dia = (p: number) =>
  `(($${p}::date)::timestamp at time zone 'America/Recife')`;

/**
 * Painel da retaguarda de Vendas. Só pedidos de vendedor.
 * VENDIDO = FATURADO pelo ERP (cteVendasFaturadas: valor faturado, data do faturamento) MENOS as devoluções que
 * entraram no período (cteDevolucoes). `faturado` e `devolvido` vão separados. A evolução diária e as categorias são do faturado. `pedidos` continua sendo
 * os pedidos feitos e liberados no período (fora de cancelado/retido/aguardando pagamento); `pedidosFaturados`, os faturados.
 * Períodos (dias do calendário de Recife): hoje = o dia; semana = os últimos 7 dias incluindo hoje; mes = do dia 1 até hoje.
 * O período anterior tem o mesmo número de dias e termina um dia antes do início do atual.
 */
@Injectable()
export class AdminVendasPainelService {
  async painel(q: PainelParametros) {
    const periodo = escolher(q.periodo, PERIODOS, 'hoje');
    const dias = Number(
      escolher(String(q.dias ?? ''), ['7', '30', '90'] as const, '7'),
    );
    const vendedorId = uuidOpcional(q.vendedorId, 'vendedorId');
    const { pool } = tenantCtx();

    const janela = await pool.query(
      `/* janela */
       select to_char(x.h, 'YYYY-MM-DD') as hoje,
              to_char(case $1::text when 'semana' then x.h - 6
                                    when 'mes' then date_trunc('month', x.h::timestamp)::date
                                    else x.h end, 'YYYY-MM-DD') as ini
         from (select (now() at time zone 'America/Recife')::date as h) x`,
      [periodo],
    );
    const hoje: string = janela.rows[0].hoje;
    const ini: string = janela.rows[0].ini;
    const fim = addDias(hoje, 1);
    const antIni = addDias(ini, -(diasEntre(ini, hoje) + 1));
    const mesIni = `${hoje.slice(0, 8)}01`;
    const mesAntIni = `${addDias(mesIni, -1).slice(0, 8)}01`;
    const anoMesAnt = mesAntIni.slice(0, 7);
    const evoIni = addDias(hoje, -(dias - 1));

    const filtroVend = (p: number, col: string) =>
      `($${p}::uuid is null or ${col} = $${p}::uuid)`;
    const base = `p.origem = 'vendedor' and ${SQL_STATUS_VENDA}`;

    const [ind, fat, ext, evo, rec, rnk, cat, met] = await Promise.all([
      pool.query(
        `/* indicadores */
         select (count(*) filter (where p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}))::int as pedidos,
                (count(*) filter (where p.criado_em >= ${dia(3)} and p.criado_em < ${dia(1)}))::int as pedidos_ant
           from pedidos p
          where ${base} and ${filtroVend(4, 'p.vendedor_id')}
            and p.criado_em >= ${dia(3)} and p.criado_em < ${dia(2)}`,
        [ini, fim, antIni, vendedorId],
      ),
      pool.query(
        `/* faturado */
         with ${cteVendasFaturadas('vf', filtroVend(4, 'p.vendedor_id'))}, ${cteDevolucoes('dv', filtroVend(4, 'd.vendedor_id'))}
         select coalesce(sum(valor) filter (where data >= ${dia(1)} and data < ${dia(2)}), 0) as vendido,
                (select coalesce(sum(valor), 0) from dv where data >= ${dia(1)} and data < ${dia(2)}) as devolvido,
                (select coalesce(sum(valor), 0) from dv where data >= ${dia(3)} and data < ${dia(1)}) as devolvido_ant,
                (count(*) filter (where data >= ${dia(1)} and data < ${dia(2)}))::int as pedidos_faturados,
                coalesce(sum(valor) filter (where data >= ${dia(3)} and data < ${dia(1)}), 0) as vendido_ant
           from vf
          where data >= ${dia(3)} and data < ${dia(2)}`,
        [ini, fim, antIni, vendedorId],
      ),
      pool.query(
        `/* extras */
         select (select count(distinct cv.cliente_id)::int from cliente_vendedor cv where ${filtroVend(3, 'cv.vendedor_id')}) as carteira,
                (select count(distinct p.cliente_id)::int from pedidos p
                  where ${base} and ${filtroVend(3, 'p.vendedor_id')}
                    and p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}
                    and exists (select 1 from cliente_vendedor cv where cv.cliente_id = p.cliente_id and ${filtroVend(3, 'cv.vendedor_id')})) as positivados,
                (select count(*)::int from pedidos p
                  where p.origem = 'vendedor' and p.status = 'AGUARDANDO_VENDEDOR' and ${filtroVend(3, 'p.vendedor_id')}) as retidos,
                (select count(*)::int from orcamentos o where o.status = 'aberto' and ${filtroVend(3, 'o.vendedor_id')}) as orc_qtd,
                (select coalesce(sum(o.total), 0) from orcamentos o where o.status = 'aberto' and ${filtroVend(3, 'o.vendedor_id')}) as orc_total`,
        [mesIni, fim, vendedorId],
      ),
      pool.query(
        `/* evolucao */
         with ${cteVendasFaturadas('vf', filtroVend(4, 'p.vendedor_id'))}
         select to_char(d.dia, 'YYYY-MM-DD') as dia, coalesce(sum(v.valor), 0) as vendido, count(v.pedido_id)::int as pedidos
           from generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') as d(dia)
           left join (select pedido_id, valor, (data at time zone 'America/Recife')::date as dia
                        from vf
                       where data >= ${dia(1)} and data < ${dia(3)}) v on v.dia = d.dia::date
          group by d.dia
          order by d.dia`,
        [evoIni, hoje, fim, vendedorId],
      ),
      pool.query(
        `/* recentes */
         select p.id, p.numero, c.nome_fantasia as cliente, vd.nome as vendedor, t.nome as tabela, p.total, p.status, p.criado_em
           from pedidos p
           join clientes c on c.id = p.cliente_id
           left join vendedores vd on vd.id = p.vendedor_id
           left join tabelas_preco t on t.id = p.tabela_preco_id
          where p.origem = 'vendedor' and ${filtroVend(1, 'p.vendedor_id')}
          order by p.criado_em desc, p.numero desc
          limit 8`,
        [vendedorId],
      ),
      pool.query(
        `/* ranking */
         with ${cteVendasFaturadas()}, ${cteDevolucoes()}
         select * from (
           select vd.id, vd.nome,
                  (select coalesce(sum(d.valor), 0) from dv d
                    where d.vendedor_id = vd.id and d.data >= ${dia(1)} and d.data < ${dia(2)}) as devolvido,
                  (select coalesce(sum(f.valor), 0) from vf f
                    where f.vendedor_id = vd.id and f.data >= ${dia(1)} and f.data < ${dia(2)}) as vendido,
                  (select count(*)::int from vf f
                    where f.vendedor_id = vd.id and f.data >= ${dia(1)} and f.data < ${dia(2)}) as pedidos_faturados,
                  (select count(*)::int from pedidos p
                    where p.vendedor_id = vd.id and ${base}
                      and p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}) as pedidos
             from vendedores vd
            where vd.ativo
         ) r
         order by (r.vendido - r.devolvido) desc, r.nome`,
        [ini, fim],
      ),
      pool.query(
        `/* categorias */
         with ${cteVendasFaturadas('vf', filtroVend(3, 'p.vendedor_id'))}
         select coalesce(cat.nome, 'Sem categoria') as nome, sum(i.total) as vendido
           from vf
           join pedido_itens i on i.pedido_id = vf.pedido_id
           join produtos pr on pr.id = i.produto_id
           left join categorias cat on cat.id = pr.categoria_id
          where vf.data >= ${dia(1)} and vf.data < ${dia(2)}
          group by coalesce(cat.nome, 'Sem categoria')
          order by sum(i.total) desc`,
        [ini, fim, vendedorId],
      ),
      // Metas: SEMPRE do mês corrente (e a base do mês anterior), qualquer que seja o filtro `periodo`.
      pool.query(
        `/* meta */
         with ${cteVendasFaturadas()}, ${cteDevolucoes()}
         select vd.id,
                (select coalesce(sum(d.valor), 0) from dv d
                  where d.vendedor_id = vd.id and d.data >= ${dia(2)} and d.data < ${dia(3)}) as devolvido_mes,
                (select coalesce(sum(d.valor), 0) from dv d
                  where d.vendedor_id = vd.id and d.data >= ${dia(1)} and d.data < ${dia(2)}) as devolvido_ant,
                (select coalesce(sum(f.valor), 0) from vf f
                  where f.vendedor_id = vd.id and f.data >= ${dia(2)} and f.data < ${dia(3)}) as vendido_mes,
                (select coalesce(sum(f.valor), 0) from vf f
                  where f.vendedor_id = vd.id and f.data >= ${dia(1)} and f.data < ${dia(2)}) as vendido_ant,
                (select m.valor from vendedor_faturamento_mensal m
                  where m.vendedor_id = vd.id and m.ano_mes = $4) as erp_ant,
                (select valor_json from configuracoes where chave = 'vendas_meta_percentual') as percentual
           from vendedores vd
          where vd.ativo and ${filtroVend(5, 'vd.id')}`,
        [mesAntIni, mesIni, fim, anoMesAnt, vendedorId],
      ),
    ]);

    const a = ind.rows[0];
    const f = fat.rows[0];
    const e = ext.rows[0];
    const pedidos = n(a.pedidos);
    const faturado = dinheiro(n(f.vendido));
    const devolvido = dinheiro(n(f.devolvido));
    // Vendido = líquido: faturado no período menos as devoluções que entraram no período.
    const vendido = dinheiro(faturado - devolvido);
    const pedidosFaturados = n(f.pedidos_faturados);
    const variacao = (atual: number, anterior: number) =>
      anterior === 0 ? null : pct1(((atual - anterior) / anterior) * 100);
    const carteira = n(e.carteira);
    const positivados = n(e.positivados);

    const percentual = lerPercentualMeta(met.rows[0]?.percentual);
    const metaPorVendedor = new Map(
      met.rows.map((r) => {
        const vendidoMes = dinheiro(n(r.vendido_mes) - n(r.devolvido_mes));
        const base = escolherBaseMeta(r.erp_ant, n(r.vendido_ant) - n(r.devolvido_ant));
        const m = calcularMeta(base.valor, vendidoMes, percentual);
        return [String(r.id), { vendidoMes, metaMes: m.metaMes, atingidoPct: m.atingidoPct }] as const;
      }),
    );
    const metas = [...metaPorVendedor.values()];
    // Só entra na conta do time quem tem meta: vendedor sem meta não pode inflar o percentual.
    // (Sem nenhuma meta no time, mostra o faturado de todos.)
    const comMeta = metas.filter((m) => m.metaMes !== null);
    const vendidoTime = dinheiro((comMeta.length ? comMeta : metas).reduce((s, m) => s + m.vendidoMes, 0));
    const metaTime = metas.some((m) => m.metaMes !== null)
      ? dinheiro(metas.reduce((s, m) => s + (m.metaMes ?? 0), 0))
      : null;

    return {
      periodo,
      indicadores: {
        pedidos,
        pedidosFaturados,
        vendido,
        faturado,
        devolvido,
        ticketMedio: pedidosFaturados ? dinheiro(faturado / pedidosFaturados) : 0,
        variacaoPedidosPct: variacao(pedidos, n(a.pedidos_ant)),
        variacaoVendidoPct: variacao(vendido, dinheiro(n(f.vendido_ant) - n(f.devolvido_ant))),
        positivacao: {
          clientesCarteira: carteira,
          clientesPositivados: positivados,
          pct: carteira ? pct1((positivados / carteira) * 100) : 0,
        },
        retidos: n(e.retidos),
        orcamentosAbertos: {
          qtd: n(e.orc_qtd),
          total: dinheiro(n(e.orc_total)),
        },
        // Meta do mês corrente (não depende de `periodo`): soma das metas dos vendedores que têm meta;
        // vendidoMes = faturado no mês pelos vendedores do escopo que têm meta.
        meta: {
          percentual,
          metaMes: metaTime,
          vendidoMes: vendidoTime,
          atingidoPct: metaTime ? pct1((vendidoTime / metaTime) * 100) : null,
        },
      },
      evolucao: evo.rows.map((r) => ({
        dia: String(r.dia),
        vendido: dinheiro(n(r.vendido)),
        pedidos: n(r.pedidos),
      })),
      recentes: rec.rows.map((r) => ({
        id: r.id,
        numero: n(r.numero),
        cliente: r.cliente,
        vendedor: r.vendedor ?? null,
        tabela: r.tabela ?? null,
        total: dinheiro(n(r.total)),
        status: r.status,
        criadoEm: iso(r.criado_em),
      })),
      ranking: rnk.rows.map((r) => ({
        vendedorId: r.id,
        nome: r.nome,
        vendido: dinheiro(n(r.vendido) - n(r.devolvido)),
        faturado: dinheiro(n(r.vendido)),
        devolvido: dinheiro(n(r.devolvido)),
        pedidos: n(r.pedidos),
        pedidosFaturados: n(r.pedidos_faturados),
        // Sempre do mês corrente, qualquer que seja o `periodo` (vendido/pedidos acima seguem o período).
        vendidoMes: metaPorVendedor.get(String(r.id))?.vendidoMes ?? 0,
        metaMes: metaPorVendedor.get(String(r.id))?.metaMes ?? null,
        atingidoPct: metaPorVendedor.get(String(r.id))?.atingidoPct ?? null,
      })),
      categorias: categoriasComOutros(
        cat.rows.map((r) => ({ nome: String(r.nome), vendido: n(r.vendido) })),
      ),
    };
  }
}

function categoriasComOutros(linhas: Array<{ nome: string; vendido: number }>) {
  const total = linhas.reduce((s, c) => s + c.vendido, 0);
  if (!linhas.length || total <= 0) return [];
  const ordenadas = [...linhas].sort((x, y) => y.vendido - x.vendido);
  const grandes = ordenadas.slice(0, 5);
  const resto = ordenadas.slice(5);
  if (resto.length)
    grandes.push({
      nome: 'Outros',
      vendido: resto.reduce((s, c) => s + c.vendido, 0),
    });
  return grandes.map((c) => ({
    nome: c.nome,
    vendido: dinheiro(c.vendido),
    pct: pct1((c.vendido / total) * 100),
  }));
}
