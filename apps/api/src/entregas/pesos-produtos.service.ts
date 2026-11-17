import { Injectable, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { pesoPorUnidadeDeVenda } from './peso-estimado';

export const SITUACOES_PESO = ['sem', 'estimado', 'cadastro'] as const;
export type SituacaoPeso = (typeof SITUACOES_PESO)[number];

export interface ProdutoPeso {
  id: string;
  nome: string;
  /** Código trocado com o ERP (o do ERP ou, sem ele, o SKU). */
  codigo: string | null;
  unidadeVenda: string | null;
  qtdPorEmbalagem: number;
  /** Peso da unidade de venda informado por alguém; null = não informado. */
  pesoCadastroKg: number | null;
  /** O que o nome do produto permite calcular; null = o nome não diz. */
  pesoEstimadoKg: number | null;
  situacao: SituacaoPeso;
}

export interface PesosProdutos {
  resumo: Record<SituacaoPeso, number>;
  /** Quantos produtos atendem ao filtro (a lista pode vir cortada em LIMITE). */
  total: number;
  produtos: ProdutoPeso[];
}

const LIMITE = 300;
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/**
 * Peso dos produtos para a montagem de carga: mostra o que já tem peso (informado ou calculado pelo nome)
 * e deixa o CD informar o peso da caixa/fardo dos que o nome não diz. Só produto ativo.
 * O sync do ERP não mexe em produtos.peso_kg, então o que for informado aqui não se perde.
 */
@Injectable()
export class PesosProdutosService {
  async listar(situacao: SituacaoPeso, busca?: string): Promise<PesosProdutos> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id, sku, erp_produto_id, nome, unidade_venda, qtd_por_embalagem, peso_kg
         from produtos where ativo order by nome`,
    );
    const resumo: Record<SituacaoPeso, number> = { sem: 0, estimado: 0, cadastro: 0 };
    const termo = semAcento(busca ?? '').trim();
    const filtrados: ProdutoPeso[] = [];
    for (const r of rows) {
      const cadastro = r.peso_kg === null || r.peso_kg === undefined || !(Number(r.peso_kg) > 0) ? null : Number(r.peso_kg);
      const estimado = pesoPorUnidadeDeVenda({ nome: r.nome, qtdPorEmbalagem: Number(r.qtd_por_embalagem), unidadeVenda: r.unidade_venda }).kg;
      const sit: SituacaoPeso = cadastro !== null ? 'cadastro' : estimado !== null ? 'estimado' : 'sem';
      resumo[sit]++;
      if (sit !== situacao) continue;
      const codigo: string | null = r.erp_produto_id ?? r.sku ?? null;
      // A busca aceita o nome, o código do ERP ou o SKU (código de barras).
      if (termo && !semAcento(`${r.nome} ${r.erp_produto_id ?? ''} ${r.sku ?? ''}`).includes(termo)) continue;
      filtrados.push({
        id: r.id, nome: r.nome, codigo, unidadeVenda: r.unidade_venda ?? null,
        qtdPorEmbalagem: Number(r.qtd_por_embalagem) || 1, pesoCadastroKg: cadastro, pesoEstimadoKg: estimado, situacao: sit,
      });
    }
    return { resumo, total: filtrados.length, produtos: filtrados.slice(0, LIMITE) };
  }

  /** pesoKg nulo apaga o peso informado: o produto volta a usar a estimativa do nome (ou fica sem peso). */
  async definir(produtoId: string, pesoKg: number | null, usuarioAdminId: string): Promise<{ ok: true }> {
    const { pool } = tenantCtx();
    const anterior = await pool.query(`select peso_kg from produtos where id = $1`, [produtoId]);
    if (!anterior.rowCount) throw new NotFoundException('Produto não encontrado');
    await pool.query(`update produtos set peso_kg = $2 where id = $1`, [produtoId, pesoKg]);
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'definir_peso_produto','produto',$2,$3)`,
      [usuarioAdminId, produtoId, JSON.stringify({ pesoKg, anterior: anterior.rows[0].peso_kg === null ? null : Number(anterior.rows[0].peso_kg) })],
    );
    return { ok: true };
  }
}
