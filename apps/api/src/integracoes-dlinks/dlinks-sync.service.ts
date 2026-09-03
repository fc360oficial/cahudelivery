import { Injectable } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { GrupoDto } from './grupo.dto';
import { FornecedorDto } from './fornecedor.dto';
import { ProdutoSyncDto } from './produto-sync.dto';
import { TabelaPrecoDto } from './tabela-preco.dto';
import { PrecoDto } from './preco.dto';
import { ClienteDto } from './cliente.dto';
import { FormaPagamentoDto } from './forma-pagamento.dto';
import { CondicaoPagamentoDto } from './condicao-pagamento.dto';

const slug = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export interface ResultadoSync {
  processados: number;
  ignorados: Array<{ item: unknown; motivo: string }>;
}

@Injectable()
export class DlinksSyncService {
  private async registrarLog(operacao: string, resumo: string, sucesso: boolean) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,$3)`,
      [operacao, resumo, sucesso],
    );
  }

  async syncGrupos(itens: GrupoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into categorias (nome, slug, erp_categoria_id)
         values ($1, $2, $3)
         on conflict (erp_categoria_id) do update set nome = excluded.nome`,
        [item.descricao, `${slug(item.descricao)}-${item.codigo}`, item.codigo],
      );
      processados++;
    }
    await this.registrarLog('sync_grupos', `${processados} grupo(s)`, true);
    return { processados, ignorados: [] };
  }

  async syncFornecedores(itens: FornecedorDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into marcas (nome, erp_marca_id)
         values ($1, $2)
         on conflict (erp_marca_id) do update set nome = excluded.nome`,
        [item.razao_social, item.codigo],
      );
      processados++;
    }
    await this.registrarLog('sync_fornecedores', `${processados} fornecedor(es)`, true);
    return { processados, ignorados: [] };
  }

  async syncTabelasPreco(itens: TabelaPrecoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into tabelas_preco (nome, erp_tabela_id)
         values ($1, $2)
         on conflict (erp_tabela_id) do update set nome = excluded.nome`,
        [item.descricao, item.id],
      );
      processados++;
    }
    await this.registrarLog('sync_tabelas_preco', `${processados} tabela(s)`, true);
    return { processados, ignorados: [] };
  }

  async syncProdutos(itens: ProdutoSyncDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    const ignorados: ResultadoSync['ignorados'] = [];
    for (const item of itens) {
      const { rows } = await pool.query(
        `insert into produtos (sku, ean, nome, marca_id, categoria_id, unidade_venda, qtd_por_embalagem, erp_produto_id, atualizado_erp_em)
         values (
           $1, $1, $2,
           (select id from marcas where erp_marca_id = $3),
           (select id from categorias where erp_categoria_id = $4),
           $5, coalesce($6, 1), $1, now()
         )
         on conflict (erp_produto_id) do update set
           nome = excluded.nome,
           marca_id = excluded.marca_id,
           categoria_id = excluded.categoria_id,
           unidade_venda = excluded.unidade_venda,
           qtd_por_embalagem = excluded.qtd_por_embalagem,
           atualizado_erp_em = now()
         returning id`,
        [item.codigo, item.descricao, item.fornecedor_codigo, item.grupo_codigo, item.unidade, item.multiplo_venda],
      );
      const produtoId = rows[0].id;
      if (item.estoque != null) {
        await pool.query(
          `insert into estoques (produto_id, quantidade) values ($1, $2)
           on conflict (produto_id) do update set quantidade = excluded.quantidade, atualizado_em = now()`,
          [produtoId, item.estoque],
        );
      }
      processados++;
    }
    await this.registrarLog('sync_produtos', `${processados} produto(s)`, true);
    return { processados, ignorados };
  }

  async syncPrecos(itens: PrecoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    const ignorados: ResultadoSync['ignorados'] = [];
    for (const item of itens) {
      const produto = await pool.query(`select id from produtos where erp_produto_id = $1`, [item.produto_codigo]);
      const tabela = await pool.query(`select id from tabelas_preco where erp_tabela_id = $1`, [item.tabela_id]);
      if (!produto.rowCount || !tabela.rowCount) {
        ignorados.push({ item, motivo: !produto.rowCount ? 'produto_nao_encontrado' : 'tabela_nao_encontrada' });
        continue;
      }
      await pool.query(
        `insert into precos (produto_id, tabela_preco_id, preco, percentual_max_desconto, percentual_max_acrescimo)
         values ($1, $2, $3, $4, $5)
         on conflict (produto_id, tabela_preco_id) do update set
           preco = excluded.preco,
           percentual_max_desconto = excluded.percentual_max_desconto,
           percentual_max_acrescimo = excluded.percentual_max_acrescimo,
           atualizado_em = now()`,
        [produto.rows[0].id, tabela.rows[0].id, item.valor, item.percentual_max_desconto ?? null, item.percentual_max_acrescimo ?? null],
      );
      processados++;
    }
    await this.registrarLog('sync_precos', `${processados} preço(s), ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados, ignorados };
  }

  /**
   * Cliente é identificado pelo `documento` (não pelo erp_cliente_id): um
   * cliente pode já existir por ter se cadastrado sozinho no app antes do
   * Dlinks empurrar o cadastro dele — nesse caso a linha existente é
   * atualizada, não duplicada. O endereço só é gravado na criação, pra não
   * sobrescrever um endereço que o cliente já tenha editado no app.
   */
  async syncClientes(itens: ClienteDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    const ignorados: ResultadoSync['ignorados'] = [];
    for (const item of itens) {
      const documento = item.cnpj_cpf.replace(/\D/g, '');
      const tipo = documento.length === 11 ? 'CPF' : 'CNPJ';
      try {
        const { rows } = await pool.query(
          `insert into clientes (tipo, documento, razao_social, nome_fantasia, email, status, erp_cliente_id, limite_credito, saldo_titulos_aberto, codigo_indicacao)
           values ($1, $2, $3, $3, $4, 'aprovado', $5, $6, $7, upper(substring(md5(random()::text) from 1 for 6)))
           on conflict (documento) do update set
             razao_social = excluded.razao_social,
             erp_cliente_id = excluded.erp_cliente_id,
             limite_credito = excluded.limite_credito,
             saldo_titulos_aberto = excluded.saldo_titulos_aberto
           returning id, (xmax = 0) as inserido`,
          [tipo, documento, item.razao_social, item.email, item.codigo, item.limite_credito ?? null, item.saldo_titulos_aberto ?? null],
        );
        const { id: clienteId, inserido } = rows[0];
        if (inserido) {
          await pool.query(
            `insert into cliente_enderecos (cliente_id, cep, logradouro, numero, complemento, bairro, cidade, uf, padrao)
             values ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
            [
              clienteId,
              item.endereco.cep,
              item.endereco.logradouro,
              item.endereco.numero,
              item.endereco.complemento ?? null,
              item.endereco.bairro,
              item.endereco.cidade,
              item.endereco.uf,
            ],
          );
        }
        processados++;
      } catch (e) {
        ignorados.push({ item, motivo: e instanceof Error ? e.message : 'erro_desconhecido' });
      }
    }
    await this.registrarLog('sync_clientes', `${processados} cliente(s), ${ignorados.length} ignorado(s)`, ignorados.length === 0);
    return { processados, ignorados };
  }

  async syncFormasPagamento(itens: FormaPagamentoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    for (const item of itens) {
      await pool.query(
        `insert into formas_pagamento_erp (erp_forma_pagamento_id, descricao)
         values ($1, $2)
         on conflict (erp_forma_pagamento_id) do update set descricao = excluded.descricao`,
        [item.codigo, item.descricao],
      );
      processados++;
    }
    await this.registrarLog('sync_formas_pagamento', `${processados} forma(s)`, true);
    return { processados, ignorados: [] };
  }

  async syncCondicoesPagamento(itens: CondicaoPagamentoDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    let processados = 0;
    const ignorados: ResultadoSync['ignorados'] = [];
    for (const item of itens) {
      const forma = await pool.query(`select id from formas_pagamento_erp where erp_forma_pagamento_id = $1`, [item.forma_pagamento_codigo]);
      if (!forma.rowCount) {
        ignorados.push({ item, motivo: 'forma_pagamento_nao_encontrada' });
        continue;
      }
      await pool.query(
        `insert into condicoes_pagamento_erp (erp_condicao_id, descricao, forma_pagamento_id)
         values ($1, $2, $3)
         on conflict (erp_condicao_id) do update set descricao = excluded.descricao, forma_pagamento_id = excluded.forma_pagamento_id`,
        [item.codigo, item.descricao, forma.rows[0].id],
      );
      processados++;
    }
    await this.registrarLog('sync_condicoes_pagamento', `${processados} condição(ões), ${ignorados.length} ignorada(s)`, ignorados.length === 0);
    return { processados, ignorados };
  }
}
