import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import {
  addDias,
  dinheiro,
  diasEntre,
  escolher,
  iso,
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
 * Painel da retaguarda de Vendas. Só pedidos de vendedor; venda = fora de cancelado/retido/aguardando pagamento.
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
    const evoIni = addDias(hoje, -(dias - 1));

    const filtroVend = (p: number, col: string) =>
      `($${p}::uuid is null or ${col} = $${p}::uuid)`;
    const base = `p.origem = 'vendedor' and ${SQL_STATUS_VENDA}`;

    const [ind, ext, evo, rec, rnk, cat] = await Promise.all([
      pool.query(
        `/* indicadores */
         select (count(*) filter (where p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}))::int as pedidos,
                coalesce(sum(p.total) filter (where p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}), 0) as vendido,
                (count(*) filter (where p.criado_em >= ${dia(3)} and p.criado_em < ${dia(1)}))::int as pedidos_ant,
                coalesce(sum(p.total) filter (where p.criado_em >= ${dia(3)} and p.criado_em < ${dia(1)}), 0) as vendido_ant
           from pedidos p
          where ${base} and ${filtroVend(4, 'p.vendedor_id')}
            and p.criado_em >= ${dia(3)} and p.criado_em < ${dia(2)}`,
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
         select to_char(d.dia, 'YYYY-MM-DD') as dia, coalesce(sum(v.total), 0) as vendido, count(v.id)::int as pedidos
           from generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') as d(dia)
           left join (select p.id, p.total, (p.criado_em at time zone 'America/Recife')::date as dia
                        from pedidos p
                       where ${base} and ${filtroVend(4, 'p.vendedor_id')}
                         and p.criado_em >= ${dia(1)} and p.criado_em < ${dia(3)}) v on v.dia = d.dia::date
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
         select vd.id, vd.nome, coalesce(sum(p.total), 0) as vendido, count(p.id)::int as pedidos
           from vendedores vd
           left join pedidos p on p.vendedor_id = vd.id and ${base}
                and p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}
          where vd.ativo
          group by vd.id, vd.nome
          order by coalesce(sum(p.total), 0) desc, vd.nome`,
        [ini, fim],
      ),
      pool.query(
        `/* categorias */
         select coalesce(cat.nome, 'Sem categoria') as nome, sum(i.total) as vendido
           from pedidos p
           join pedido_itens i on i.pedido_id = p.id
           join produtos pr on pr.id = i.produto_id
           left join categorias cat on cat.id = pr.categoria_id
          where ${base} and ${filtroVend(3, 'p.vendedor_id')}
            and p.criado_em >= ${dia(1)} and p.criado_em < ${dia(2)}
          group by coalesce(cat.nome, 'Sem categoria')
          order by sum(i.total) desc`,
        [ini, fim, vendedorId],
      ),
    ]);

    const a = ind.rows[0];
    const e = ext.rows[0];
    const pedidos = n(a.pedidos);
    const vendido = dinheiro(n(a.vendido));
    const variacao = (atual: number, anterior: number) =>
      anterior === 0 ? null : pct1(((atual - anterior) / anterior) * 100);
    const carteira = n(e.carteira);
    const positivados = n(e.positivados);

    return {
      periodo,
      indicadores: {
        pedidos,
        vendido,
        ticketMedio: pedidos ? dinheiro(vendido / pedidos) : 0,
        variacaoPedidosPct: variacao(pedidos, n(a.pedidos_ant)),
        variacaoVendidoPct: variacao(vendido, dinheiro(n(a.vendido_ant))),
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
        vendido: dinheiro(n(r.vendido)),
        pedidos: n(r.pedidos),
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
