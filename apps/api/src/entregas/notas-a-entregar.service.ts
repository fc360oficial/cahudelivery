import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { pesoPorUnidadeDeVenda } from './peso-estimado';

export interface EnderecoEntrega {
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface EntregaPendente {
  /** "pedido:<uuid>" (nasceu no Fluxo Commerce) ou "nota:<uuid>" (digitado direto no ERP). */
  id: string;
  /** De onde veio o pedido: app, site, vendedor ou televendas. */
  origem: string;
  /** Número do pedido (o nosso ou o do ERP), quando houver. */
  pedidoNumero: string | null;
  cliente: string;
  telefone: string | null;
  endereco: EnderecoEntrega;
  latitude: number | null;
  longitude: number | null;
  nota: { numero: string; serie: string | null } | null;
  emitidaEm: string | null;
  total: number | null;
  /** Caixas e fardos: o que a nota informa ou, sem isso, a soma das quantidades. */
  volumes: number;
  /** Peso estimado em kg; null quando nenhum item tem peso conhecido. */
  pesoKg: number | null;
  /** Itens cujo peso não deu para saber (o peso acima fica faltando esses). */
  itensSemPeso: number;
  itens: number;
}

export interface NotasAEntregar {
  resumo: { entregas: number; volumes: number; pesoKg: number; comPesoIncompleto: number; semLocalizacao: number };
  entregas: EntregaPendente[];
}

interface ItemBruto { produtoId?: string | null; codigo?: string | null; descricao?: string | null; quantidade: number }
interface ProdutoPeso { id: string; sku: string | null; erp_produto_id: string | null; nome: string; unidade_venda: string | null; qtd_por_embalagem: string | null; peso_kg: string | null }

const ORIGEM: Record<string, string> = { app_cliente: 'app', site: 'site', vendedor: 'vendedor' };
const numero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ouNulo = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const arredondar = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;

/**
 * O que está faturado e ainda não foi entregue, de todas as origens:
 *  - pedidos do aplicativo, do site e do Fluxo Vendas (status FATURADO, tipo entrega);
 *  - notas dos pedidos digitados direto no ERP, recebidas em /integracoes/dlinks/notas-entrega.
 * É a matéria-prima da montagem de carga. Só lê; não muda status de nada.
 */
@Injectable()
export class NotasAEntregarService {
  async listar(): Promise<NotasAEntregar> {
    const { pool } = tenantCtx();

    const pedidos = await pool.query(
      `select p.id, p.numero, p.origem, p.total, p.endereco_snapshot_json as endereco,
              coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente, c.telefone,
              n.numero_nf, n.serie, n.emitida_em,
              f.total as total_faturado, f.itens_json as itens_faturados,
              (select json_agg(json_build_object('produtoId', i.produto_id, 'descricao', i.descricao_snapshot, 'quantidade', i.quantidade))
                 from pedido_itens i where i.pedido_id = p.id) as itens_pedido,
              e.latitude, e.longitude
         from pedidos p
         join clientes c on c.id = p.cliente_id
         left join pedido_notas n on n.pedido_id = p.id
         left join pedido_faturamentos f on f.pedido_id = p.id
         left join cliente_enderecos e
                on e.id = case when p.endereco_snapshot_json->>'id' ~ '^[0-9a-fA-F-]{36}$'
                               then (p.endereco_snapshot_json->>'id')::uuid end
        where p.status = 'FATURADO' and p.tipo_entrega = 'entrega'
        order by n.emitida_em nulls last, p.numero`,
    );

    const notas = await pool.query(
      `select ne.id, ne.numero_nf, ne.serie, ne.pedido_numero, ne.origem, ne.total, ne.volumes, ne.peso_bruto_kg,
              ne.destinatario_json as destinatario, ne.itens_json as itens, ne.emitida_em,
              coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente, c.telefone,
              e.cep as cep_cadastro, e.complemento, e.latitude, e.longitude
         from notas_entrega ne
         left join clientes c on c.id = ne.cliente_id
         left join lateral (select x.cep, x.complemento, x.latitude, x.longitude
                              from cliente_enderecos x
                             where x.cliente_id = ne.cliente_id
                             order by x.padrao desc limit 1) e on true
        where ne.status = 'FATURADO' and ne.tipo_entrega = 'entrega'
        order by ne.emitida_em nulls last, ne.numero_nf`,
    );

    // Itens de cada entrega, ainda sem peso.
    const brutos = new Map<string, ItemBruto[]>();
    for (const p of pedidos.rows) {
      // O faturado é o que saiu de verdade (o ERP pode ter cortado item); sem ele, vale o pedido.
      const faturados = Array.isArray(p.itens_faturados) ? (p.itens_faturados as Array<Record<string, unknown>>) : [];
      const doPedido = Array.isArray(p.itens_pedido) ? (p.itens_pedido as Array<Record<string, unknown>>) : [];
      brutos.set(
        `pedido:${p.id}`,
        faturados.length
          ? faturados.map((i) => ({ codigo: ouNulo(i.produto_codigo), quantidade: numero(i.quantidade) }))
          : doPedido.map((i) => ({ produtoId: ouNulo(i.produtoId), descricao: ouNulo(i.descricao), quantidade: numero(i.quantidade) })),
      );
    }
    for (const n of notas.rows) {
      const itens = Array.isArray(n.itens) ? (n.itens as Array<Record<string, unknown>>) : [];
      brutos.set(`nota:${n.id}`, itens.map((i) => ({ codigo: ouNulo(i.codigo), descricao: ouNulo(i.descricao), quantidade: numero(i.quantidade) })));
    }

    const produtos = await this.produtosDosItens([...brutos.values()].flat());

    const medir = (chave: string) => {
      const itens = brutos.get(chave) ?? [];
      let peso = 0;
      let comPeso = 0;
      let volumes = 0;
      for (const item of itens) {
        volumes += item.quantidade;
        const produto = (item.produtoId && produtos.porId.get(item.produtoId)) || (item.codigo && produtos.porCodigo.get(item.codigo)) || null;
        const nome = produto?.nome ?? item.descricao ?? '';
        const unidade = pesoPorUnidadeDeVenda({
          nome, pesoKg: produto?.peso_kg === null || produto?.peso_kg === undefined ? null : Number(produto.peso_kg),
          qtdPorEmbalagem: produto ? Number(produto.qtd_por_embalagem) : null, unidadeVenda: produto?.unidade_venda ?? null,
        });
        if (unidade.kg !== null) {
          peso += unidade.kg * item.quantidade;
          comPeso++;
        }
      }
      return { itens: itens.length, volumes, pesoKg: comPeso ? arredondar(peso, 1) : null, itensSemPeso: itens.length - comPeso };
    };

    const entregas: EntregaPendente[] = [];

    for (const p of pedidos.rows) {
      const end = (p.endereco ?? {}) as Record<string, unknown>;
      const m = medir(`pedido:${p.id}`);
      entregas.push({
        id: `pedido:${p.id}`,
        origem: ORIGEM[String(p.origem)] ?? String(p.origem),
        pedidoNumero: p.numero === null ? null : String(p.numero),
        cliente: p.cliente ?? 'Cliente sem nome',
        telefone: ouNulo(p.telefone),
        endereco: {
          logradouro: ouNulo(end.logradouro), numero: ouNulo(end.numero), complemento: ouNulo(end.complemento),
          bairro: ouNulo(end.bairro), cidade: ouNulo(end.cidade), uf: ouNulo(end.uf), cep: ouNulo(end.cep),
        },
        latitude: p.latitude ?? null,
        longitude: p.longitude ?? null,
        nota: p.numero_nf ? { numero: String(p.numero_nf), serie: ouNulo(p.serie) } : null,
        emitidaEm: p.emitida_em ? new Date(p.emitida_em).toISOString() : null,
        total: p.total_faturado !== null && p.total_faturado !== undefined ? Number(p.total_faturado) : p.total === null ? null : Number(p.total),
        volumes: arredondar(m.volumes, 3),
        pesoKg: m.pesoKg,
        itensSemPeso: m.itensSemPeso,
        itens: m.itens,
      });
    }

    for (const n of notas.rows) {
      const dest = (n.destinatario ?? {}) as { nome?: string; fone?: string | null; endereco?: Record<string, unknown> };
      const end = dest.endereco ?? {};
      const m = medir(`nota:${n.id}`);
      // A coordenada do cadastro só vale se for do mesmo CEP da nota: endereço de entrega diferente não herda o ponto.
      const mesmoCep = soDigitos(n.cep_cadastro) !== '' && soDigitos(n.cep_cadastro) === soDigitos(end.cep);
      const pesoDaNota = n.peso_bruto_kg === null || n.peso_bruto_kg === undefined ? null : Number(n.peso_bruto_kg);
      entregas.push({
        id: `nota:${n.id}`,
        origem: ouNulo(n.origem) ?? 'televendas',
        pedidoNumero: ouNulo(n.pedido_numero),
        cliente: n.cliente ?? ouNulo(dest.nome) ?? 'Cliente sem nome',
        telefone: ouNulo(n.telefone) ?? ouNulo(dest.fone),
        endereco: {
          logradouro: ouNulo(end.logradouro), numero: ouNulo(end.numero), complemento: mesmoCep ? ouNulo(n.complemento) : null,
          bairro: ouNulo(end.bairro), cidade: ouNulo(end.municipio), uf: ouNulo(end.uf), cep: ouNulo(end.cep),
        },
        latitude: mesmoCep ? n.latitude ?? null : null,
        longitude: mesmoCep ? n.longitude ?? null : null,
        nota: { numero: String(n.numero_nf), serie: ouNulo(n.serie) },
        emitidaEm: n.emitida_em ? new Date(n.emitida_em).toISOString() : null,
        total: n.total === null || n.total === undefined ? null : Number(n.total),
        volumes: n.volumes === null || n.volumes === undefined ? arredondar(m.volumes, 3) : Number(n.volumes),
        // Peso que a própria nota traz vence a estimativa (hoje o ERP não preenche).
        pesoKg: pesoDaNota ?? m.pesoKg,
        itensSemPeso: pesoDaNota === null ? m.itensSemPeso : 0,
        itens: m.itens,
      });
    }

    return {
      resumo: {
        entregas: entregas.length,
        volumes: arredondar(entregas.reduce((s, e) => s + e.volumes, 0), 3),
        pesoKg: arredondar(entregas.reduce((s, e) => s + (e.pesoKg ?? 0), 0), 1),
        comPesoIncompleto: entregas.filter((e) => e.itensSemPeso > 0).length,
        semLocalizacao: entregas.filter((e) => e.latitude === null || e.longitude === null).length,
      },
      entregas,
    };
  }

  /** Produtos citados nos itens, achados pelo id (pedido) ou pelo código trocado com o ERP (faturamento e nota). */
  private async produtosDosItens(itens: ItemBruto[]) {
    const { pool } = tenantCtx();
    const ids = [...new Set(itens.map((i) => i.produtoId).filter((v): v is string => !!v))];
    const codigos = [...new Set(itens.map((i) => i.codigo).filter((v): v is string => !!v))];
    const porId = new Map<string, ProdutoPeso>();
    const porCodigo = new Map<string, ProdutoPeso>();
    if (!ids.length && !codigos.length) return { porId, porCodigo };
    const { rows } = await pool.query(
      `select id, sku, erp_produto_id, nome, unidade_venda, qtd_por_embalagem, peso_kg
         from produtos
        where id = any($1::uuid[]) or erp_produto_id = any($2::text[]) or sku = any($2::text[])`,
      [ids, codigos],
    );
    for (const p of rows as ProdutoPeso[]) {
      porId.set(p.id, p);
      // O código trocado com o ERP é coalesce(erp_produto_id, sku): o do ERP entra por último para prevalecer.
      if (p.sku) porCodigo.set(p.sku, p);
    }
    for (const p of rows as ProdutoPeso[]) if (p.erp_produto_id) porCodigo.set(p.erp_produto_id, p);
    return { porId, porCodigo };
  }
}
