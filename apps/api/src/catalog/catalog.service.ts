import { Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { DatabaseService } from '../database/database.service';

export interface FiltroProdutos {
  categoria?: string;
  marca?: string;
  busca?: string;
  promocao?: boolean;
  pagina: number;
  limite: number;
}

/** Colunas + preço resolvido (promoção vigente vence a tabela) + estoque. */
const SELECT_PRODUTO = `
  select p.id, p.sku, p.ean, p.nome, p.descricao, p.unidade_venda, p.qtd_por_embalagem,
         p.qtd_minima, p.desconto_qtd_minima, p.desconto_qtd_preco, m.nome as marca, c.nome as categoria, c.id as categoria_id,
         coalesce(e.quantidade, 0) as estoque,
         pr.preco as preco_tabela,
         promo.preco_promocional,
         coalesce(promo.preco_promocional, pr.preco) as preco,
         (select json_agg(json_build_object('url', pi.url, 'ordem', pi.ordem) order by pi.ordem)
            from produto_imagens pi where pi.produto_id = p.id) as imagens
    from produtos p
    left join marcas m on m.id = p.marca_id
    left join categorias c on c.id = p.categoria_id
    left join estoques e on e.produto_id = p.id
    left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $1
    left join lateral (
      select pp.preco_promocional
        from promocao_produtos pp
        join promocoes pm on pm.id = pp.promocao_id
       where pp.produto_id = p.id and pm.ativo and now() between pm.inicio_em and pm.fim_em
       order by pp.preco_promocional asc limit 1
    ) promo on true
   where p.ativo`;

@Injectable()
export class CatalogService {
  constructor(private readonly db: DatabaseService) {}

  /** Tabela de preço do cliente logado, ou a padrão do tenant. */
  async tabelaPrecoDe(clienteId?: string): Promise<string | null> {
    const { pool } = tenantCtx();
    if (clienteId) {
      const r = await pool.query(`select tabela_preco_id from clientes where id = $1`, [clienteId]);
      if (r.rows[0]?.tabela_preco_id) return r.rows[0].tabela_preco_id;
    }
    const p = await pool.query(`select id from tabelas_preco where padrao limit 1`);
    return p.rows[0]?.id ?? null;
  }

  async config() {
    const { tenant, pool } = tenantCtx();
    const tema = await this.db
      .controlPool()
      .query(`select cor_primaria, cor_secundaria, logo_url, splash_url, config_json from tenant_temas where tenant_id = $1`, [tenant.id]);
    const cfg = await pool.query(`select chave, valor_json from configuracoes`);
    return {
      appNome: tenant.appNome,
      distribuidora: tenant.nomeFantasia,
      tema: tema.rows[0] ?? null,
      configuracoes: Object.fromEntries(cfg.rows.map((r) => [r.chave, r.valor_json])),
    };
  }

  async home(clienteId?: string) {
    const { pool } = tenantCtx();
    const tabela = await this.tabelaPrecoDe(clienteId);
    const [banners, promocoes, maisVendidos, categoriasComProduto, patrocinadores] = await Promise.all([
      pool.query(
        `select id, titulo, imagem_url, destino_tipo, destino_id from banners
          where ativo and (inicio_em is null or now() >= inicio_em) and (fim_em is null or now() <= fim_em)
          order by ordem`,
      ),
      pool.query(`${SELECT_PRODUTO} and promo.preco_promocional is not null order by p.nome limit 10`, [tabela]),
      pool.query(
        `${SELECT_PRODUTO} and p.id in (
           select pi2.produto_id from pedido_itens pi2
             join pedidos pe on pe.id = pi2.pedido_id and pe.criado_em > now() - interval '30 days'
            group by pi2.produto_id order by sum(pi2.quantidade) desc limit 10)`,
        [tabela],
      ),
      // Categorias que têm produto ativo, na ordem cadastrada — vira "prateleira" na home.
      pool.query(
        `select c.id, c.nome from categorias c
          where c.ativo and exists (select 1 from produtos p where p.categoria_id = c.id and p.ativo)
          order by c.ordem, c.nome`,
      ),
      // Vitrines patrocinadas (indústria/fabricante) — produtos escolhidos manualmente,
      // com preço especial vencendo promoção que vence tabela (mesma precedência do SELECT_PRODUTO).
      pool.query(
        `select pat.id, pat.nome, pat.logo_url, pat.banner_url, pat.apos_categoria_id,
                (select json_agg(json_build_object(
                    'id', p.id, 'sku', p.sku, 'nome', p.nome, 'unidade_venda', p.unidade_venda,
                    'qtd_por_embalagem', p.qtd_por_embalagem, 'qtd_minima', p.qtd_minima, 'estoque', coalesce(e.quantidade,0),
                    'preco_tabela', pr.preco, 'preco_promocional', promo.preco_promocional,
                    'preco', coalesce(pp.preco_especial, promo.preco_promocional, pr.preco),
                    'imagens', (select json_agg(json_build_object('url', pi.url,'ordem', pi.ordem) order by pi.ordem)
                                  from produto_imagens pi where pi.produto_id = p.id)
                  ) order by pp.ordem)
                   from patrocinador_produtos pp
                   join produtos p on p.id = pp.produto_id and p.ativo
                   left join estoques e on e.produto_id = p.id
                   left join precos pr on pr.produto_id = p.id and pr.tabela_preco_id = $1
                   left join lateral (
                     select ppo.preco_promocional from promocao_produtos ppo
                       join promocoes pm on pm.id = ppo.promocao_id
                      where ppo.produto_id = p.id and pm.ativo and now() between pm.inicio_em and pm.fim_em
                      order by ppo.preco_promocional asc limit 1
                   ) promo on true
                  where pp.patrocinador_id = pat.id
                ) as produtos
           from patrocinadores pat where pat.ativo order by pat.criado_em`,
        [tabela],
      ),
    ]);

    // Navegação por descoberta: uma prateleira horizontal por categoria (estilo "vitrine de loja"),
    // não só recomendação. Busca em paralelo, limitando itens por prateleira para a home carregar rápido.
    const prateleiras = await Promise.all(
      categoriasComProduto.rows.map(async (c) => {
        const { rows } = await pool.query(
          `${SELECT_PRODUTO} and p.categoria_id = $2 order by p.nome limit 10`,
          [tabela, c.id],
        );
        return { tipo: 'categoria' as const, categoriaId: c.id, nome: c.nome, produtos: rows };
      }),
    );

    // Mescla as vitrines patrocinadas ativas na posição escolhida na retaguarda:
    // logo depois da categoria referenciada (apos_categoria_id), ou no topo se nulo.
    interface PatrocinadorItem {
      tipo: 'patrocinador';
      id: string;
      nome: string;
      logoUrl: string;
      bannerUrl: string;
      produtos: unknown[];
    }
    const topo: PatrocinadorItem[] = [];
    const depoisDaCategoria = new Map<string, PatrocinadorItem[]>();
    for (const row of patrocinadores.rows) {
      if (!row.produtos?.length) continue;
      const item: PatrocinadorItem = {
        tipo: 'patrocinador',
        id: row.id,
        nome: row.nome,
        logoUrl: row.logo_url,
        bannerUrl: row.banner_url,
        produtos: row.produtos,
      };
      if (row.apos_categoria_id) {
        const lista = depoisDaCategoria.get(row.apos_categoria_id) ?? [];
        lista.push(item);
        depoisDaCategoria.set(row.apos_categoria_id, lista);
      } else {
        topo.push(item);
      }
    }
    const feed: unknown[] = [...topo];
    const categoriasNaFeed = new Set<string>();
    for (const prat of prateleiras.filter((p) => p.produtos.length > 0)) {
      feed.push(prat);
      categoriasNaFeed.add(prat.categoriaId);
      const extras = depoisDaCategoria.get(prat.categoriaId);
      if (extras) feed.push(...extras);
    }

    // Fallback: patrocinador cuja categoria-âncora não virou prateleira (ficou sem produto
    // ativo — ex.: tudo saiu de estoque ou foi desativado). Sem isso a vitrine paga sumiria
    // silenciosamente do feed. Cai pro topo da home, junto dos patrocinadores sem âncora.
    const orfaos: PatrocinadorItem[] = [];
    for (const [categoriaId, itens] of depoisDaCategoria) {
      if (categoriasNaFeed.has(categoriaId)) continue;
      for (const item of itens) {
        console.warn(
          `[catalog.home] patrocinador "${item.nome}" (id=${item.id}) ficou órfão: a categoria-âncora ${categoriaId} não tem produtos ativos no momento. Caindo para o topo da home como fallback.`,
        );
        orfaos.push(item);
      }
    }
    if (orfaos.length) feed.splice(topo.length, 0, ...orfaos);

    return {
      banners: banners.rows,
      promocoes: promocoes.rows,
      maisVendidos: maisVendidos.rows,
      prateleiras: feed,
    };
  }

  async categorias() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, pai_id, nome, slug, imagem_url, ordem from categorias where ativo order by ordem, nome`,
    );
    return rows;
  }

  async produtos(f: FiltroProdutos, clienteId?: string) {
    const { pool } = tenantCtx();
    const tabela = await this.tabelaPrecoDe(clienteId);
    const cond: string[] = [];
    const params: unknown[] = [tabela];
    if (f.categoria) {
      params.push(f.categoria);
      cond.push(`(p.categoria_id = $${params.length} or c.pai_id = $${params.length})`);
    }
    if (f.marca) {
      params.push(f.marca);
      cond.push(`p.marca_id = $${params.length}`);
    }
    if (f.busca) {
      params.push(f.busca);
      cond.push(
        `to_tsvector('portuguese', imm_unaccent(p.nome || ' ' || coalesce(p.descricao,''))) @@ plainto_tsquery('portuguese', imm_unaccent($${params.length}))`,
      );
    }
    if (f.promocao) cond.push(`promo.preco_promocional is not null`);
    const where = cond.length ? ` and ${cond.join(' and ')}` : '';
    params.push(f.limite, (f.pagina - 1) * f.limite);
    const { rows } = await pool.query(
      `${SELECT_PRODUTO}${where} order by p.nome limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { dados: rows, pagina: f.pagina };
  }

  async produto(id: string, clienteId?: string) {
    const { pool } = tenantCtx();
    const tabela = await this.tabelaPrecoDe(clienteId);
    const { rows } = await pool.query(`${SELECT_PRODUTO} and p.id = $2`, [tabela, id]);
    if (!rows[0]) throw new NotFoundException('Produto não encontrado');
    return rows[0];
  }

  async promocoes(clienteId?: string) {
    const { pool } = tenantCtx();
    const tabela = await this.tabelaPrecoDe(clienteId);
    const { rows } = await pool.query(
      `${SELECT_PRODUTO} and promo.preco_promocional is not null order by p.nome limit 100`,
      [tabela],
    );
    return rows;
  }
}
