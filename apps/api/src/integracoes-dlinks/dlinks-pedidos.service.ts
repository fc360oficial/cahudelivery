import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { tenantCtx } from '../tenancy/tenant-context';
import { creditarIndicacao } from '../orders/creditar-indicacao';
import { urlNota } from '../notas/assinatura';
import { PedidoFaturadoDto, NotaFiscalDto } from './pedido-faturado.dto';

const parserChave = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  processEntities: false,
});

/** Chave de acesso do próprio XML (atributo Id de infNFe, sem o prefixo "NFe"). */
export function extrairChaveDoXml(xml: string): string | null {
  try {
    const raiz = parserChave.parse(xml) as Record<string, any>;
    const id = (raiz?.nfeProc?.NFe ?? raiz?.NFe)?.infNFe?.['@Id'];
    if (!id) return null;
    const chave = String(id).replace(/^NFe/, '');
    return /^\d{44}$/.test(chave) ? chave : null;
  } catch {
    return null;
  }
}

/**
 * O Dlinks manda `valores` em centavos e `itens` em reais — confirmado contra
 * o XML em 22/09/2026 (total 23400 para uma nota de R$ 234,00). Ver
 * docs/superpowers/specs/2026-09-22-nfe-xml-danfe-design.md.
 */
export function normalizarCentavos(valor: number): number {
  return Math.round(valor) / 100;
}

export interface PedidoDlinks {
  codigo: string;
  numero: number;
  criadoEm: string;
  /** Devolve ao Dlinks o mesmo cadastro que ele sobe no POST /clientes (+ o que o cliente preencheu no app). */
  cliente: {
    codigo: string | null; // código do cliente no ERP (o que o Dlinks mandou como "codigo"); null = cliente ainda não sincronizado
    documento: string; // CNPJ/CPF só dígitos
    tipo: string; // 'CNPJ' | 'CPF'
    razaoSocial: string | null;
    nomeFantasia: string | null;
    email: string | null;
    telefone: string | null;
    erpClienteId: string | null; // mantido por compatibilidade — mesmo valor de `codigo`
  };
  tipoEntrega: string;
  endereco: Record<string, unknown> | null;
  formaPagamento: string;
  condicaoPagamento: string | null;
  itens: Array<{ erpProdutoId: string; quantidade: number; precoUnit: number }>;
  valorAbatidoSaldo: number;
}

export interface ResultadoLote {
  processados: string[];
  ignorados: Array<{ codigo: string; motivo: 'nao_encontrado' | 'status_invalido' | 'erro_interno' }>;
}

@Injectable()
export class DlinksPedidosService {
  private readonly log = new Logger('DlinksPedidosService');

  async listar(dataInicial: string, dataFinal: string): Promise<{ pedidos: PedidoDlinks[] }> {
    const { pool } = tenantCtx();
    const inicio = Date.now();
    const { rows } = await pool.query(
      `select p.id, p.numero, p.criado_em, p.tipo_entrega, p.forma_pagamento, p.condicao_pagamento,
              p.endereco_snapshot_json, p.valor_saldo_usado,
              c.documento, c.erp_cliente_id, c.tipo, c.razao_social, c.nome_fantasia, c.email, c.telefone,
              (select json_agg(json_build_object(
                  'erpProdutoId', coalesce(pr.erp_produto_id, pr.sku),
                  'quantidade', i.quantidade, 'precoUnit', i.preco_unit))
                 from pedido_itens i join produtos pr on pr.id = i.produto_id
                where i.pedido_id = p.id) as itens
         from pedidos p join clientes c on c.id = p.cliente_id
        where p.criado_em >= ($1::date)::timestamp at time zone 'America/Recife'
          and p.criado_em < ($2::date + 1)::timestamp at time zone 'America/Recife'
        order by p.criado_em`,
      [dataInicial, dataFinal],
    );
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso, duracao_ms)
       values ('consulta_pedidos','erp_para_fluxo',$1,$2,true,$3)`,
      [`${dataInicial} a ${dataFinal}`, `${rows.length} pedido(s)`, Date.now() - inicio],
    );
    return {
      pedidos: rows.map((r) => ({
        codigo: r.id,
        // pedidos.numero é bigint — node-pg devolve string, converter pro Dlinks receber número
        numero: Number(r.numero),
        criadoEm: r.criado_em,
        cliente: {
          codigo: r.erp_cliente_id,
          documento: r.documento,
          tipo: r.tipo,
          razaoSocial: r.razao_social,
          nomeFantasia: r.nome_fantasia,
          email: r.email,
          telefone: r.telefone,
          erpClienteId: r.erp_cliente_id,
        },
        tipoEntrega: r.tipo_entrega,
        endereco: r.endereco_snapshot_json,
        formaPagamento: r.forma_pagamento,
        condicaoPagamento: r.condicao_pagamento,
        itens: r.itens ?? [],
        valorAbatidoSaldo: Number(r.valor_saldo_usado) || 0,
      })),
    };
  }

  async marcarRecebido(codigos: string[]): Promise<ResultadoLote> {
    return this.transicionar(codigos, {
      statusPermitido: (status) => status === 'RECEBIDO',
      novoStatus: 'ENVIADO_ERP',
      detalhe: '',
      operacao: 'pedido_recebido',
    });
  }

  async marcarCancelado(codigos: string[]): Promise<ResultadoLote> {
    return this.transicionar(codigos, {
      statusPermitido: (status) => status !== 'ENTREGUE' && status !== 'CANCELADO',
      novoStatus: 'CANCELADO',
      detalhe: '',
      operacao: 'pedido_cancelado',
      estornarSaldo: true,
    });
  }

  /**
   * POST /pedidos-faturados: o app reflete o status que o Dlinks está
   * enviando. ABERTO/EM_FATURAMENTO sobrescrevem até um pedido já FATURADO
   * (reabertura + nova carga no ERP) — só não sobrepõem estados finais
   * (ENTREGUE/CANCELADO). CANCELADO reaproveita o mesmo caminho de
   * /pedidos/cancelado (estorno de saldo incluso). FATURADO credita a
   * indicação, se houver.
   */
  async marcarFaturado(dto: PedidoFaturadoDto): Promise<ResultadoLote> {
    const { pedido_codigo: pedidoCodigo, status: statusErp, valores, itens, nota_fiscal: notaFiscal } = dto;
    if (statusErp === 'CANCELADO') {
      return this.marcarCancelado([pedidoCodigo]);
    }
    if (statusErp === 'ABERTO' || statusErp === 'EM_FATURAMENTO') {
      return this.transicionar([pedidoCodigo], {
        statusPermitido: (status) => status !== 'CANCELADO' && status !== 'ENTREGUE',
        novoStatus: statusErp,
        detalhe: '',
        operacao: 'pedido_status_erp',
      });
    }

    // Valida a nota ANTES de comitar a transição de status: uma chave
    // incoerente (ou XML sem infNFe) não pode virar 400 depois que o pedido
    // já mudou de status — bug visto na revisão final de 22/09/2026. O XML
    // já decodificado/validado segue para gravarFaturamento/gravarNota, que
    // não precisam decodificar de novo.
    const xmlNota = notaFiscal ? await this.validarNota(pedidoCodigo, notaFiscal) : undefined;

    const resultado = await this.transicionar([pedidoCodigo], {
      statusPermitido: (status) => status !== 'FATURADO' && status !== 'CANCELADO' && status !== 'ENTREGUE',
      novoStatus: 'FATURADO',
      detalhe: '',
      operacao: 'pedido_faturado',
      aposCommit: async (client, codigo) => {
        await creditarIndicacao(client, codigo);
      },
    });

    // A nota grava fora do caminho de transição: no reenvio de FATURADO não há
    // transição, e mesmo assim queremos a NF-e. Só 'nao_encontrado' impede —
    // pedido_notas.pedido_id tem FK para pedidos(id), então gravar antes de
    // saber que o pedido existe estouraria violação de chave estrangeira.
    const inexistente = resultado.ignorados.some((i) => i.codigo === pedidoCodigo && i.motivo === 'nao_encontrado');
    if (!inexistente) {
      if (valores) await this.gravarFaturamento(pedidoCodigo, valores, itens ?? [], notaFiscal, xmlNota);
      if (notaFiscal) await this.gravarNota(pedidoCodigo, notaFiscal, xmlNota!);
    }
    return resultado;
  }

  /**
   * Decodifica o xml_base64 e confere a chave contra o payload ANTES de
   * qualquer transição de status ser comitada. Loga 'nota_xml_invalido' e
   * 'nota_chave_divergente' em integracao_logs — o mesmo par de logs que
   * gravarNota fazia antes, só que agora antes do commit.
   */
  private async validarNota(codigo: string, nota: NotaFiscalDto): Promise<string> {
    const { pool } = tenantCtx();
    const xml = Buffer.from(nota.xml_base64, 'base64').toString('utf8');
    const chaveXml = extrairChaveDoXml(xml);

    if (!chaveXml) {
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
         values ('nota_xml_invalido','erp_para_fluxo',$1,$2,false)`,
        [codigo, 'xml_base64 não contém uma NF-e válida'],
      );
      throw new BadRequestException('xml_base64 não contém uma NF-e válida');
    }
    if (chaveXml !== nota.chave) {
      await pool.query(
        `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
         values ('nota_chave_divergente','erp_para_fluxo',$1,$2,false)`,
        [codigo, `payload ${nota.chave} vs XML ${chaveXml}`],
      );
      throw new BadRequestException('chave da nota_fiscal diverge da chave do XML');
    }
    return xml;
  }

  /** Valores reais do faturamento, normalizados de centavos para reais. */
  private async gravarFaturamento(
    codigo: string,
    valores: NonNullable<PedidoFaturadoDto['valores']>,
    itens: NonNullable<PedidoFaturadoDto['itens']>,
    notaFiscal: NotaFiscalDto | undefined,
    xmlNota: string | undefined,
  ): Promise<void> {
    const { pool } = tenantCtx();
    const total = normalizarCentavos(valores.total);

    // Confere contra o XML quando há nota. Se o Dlinks mudar o formato de
    // `valores` um dia, a gente descobre por este log em vez de voltar a
    // gravar 100x errado em silêncio.
    if (notaFiscal && xmlNota) {
      const vNF = Number(/<vNF>([\d.]+)<\/vNF>/.exec(xmlNota)?.[1]);
      if (Number.isFinite(vNF) && Math.abs(vNF - total) > 0.01) {
        this.log.warn(`pedido ${codigo}: total do payload (${total}) diverge do vNF do XML (${vNF})`);
        await pool.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, response_resumo, sucesso)
           values ('faturamento_divergente','erp_para_fluxo',$1,$2,false)`,
          [codigo, `payload ${total} vs XML ${vNF}`],
        );
      }
    }

    await pool.query(
      `insert into pedido_faturamentos (pedido_id, subtotal, desconto, total, itens_json)
       values ($1, $2, $3, $4, $5)
       on conflict (pedido_id) do update set
         subtotal = excluded.subtotal, desconto = excluded.desconto,
         total = excluded.total, itens_json = excluded.itens_json, faturado_em = now()`,
      [
        codigo,
        normalizarCentavos(valores.subtotal),
        normalizarCentavos(valores.desconto ?? 0),
        total,
        JSON.stringify(itens),
      ],
    );
  }

  /** Guarda a NF-e e as URLs assinadas de XML e DANFE. Chave já validada por validarNota(). */
  private async gravarNota(codigo: string, nota: NotaFiscalDto, xml: string): Promise<void> {
    const { pool, tenant } = tenantCtx();

    const xmlUrl = urlNota(tenant.slug, codigo, 'xml');
    const pdfUrl = urlNota(tenant.slug, codigo, 'pdf');
    if (!xmlUrl || !pdfUrl) {
      this.log.error(`PUBLIC_URL não configurada — nota do pedido ${codigo} fica sem link de download`);
    }

    await pool.query(
      `insert into pedido_notas (pedido_id, numero_nf, serie, chave_acesso, xml, xml_url, pdf_url, emitida_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (pedido_id) do update set
         numero_nf = excluded.numero_nf, serie = excluded.serie,
         chave_acesso = excluded.chave_acesso, xml = excluded.xml,
         xml_url = excluded.xml_url, pdf_url = excluded.pdf_url,
         emitida_em = excluded.emitida_em`,
      [codigo, nota.numero, nota.serie, nota.chave, xml, xmlUrl, pdfUrl, nota.emitida_em ?? null],
    );
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso)
       values ('nota_fiscal_recebida','erp_para_fluxo',$1,true)`,
      [`${codigo} NF ${nota.numero}/${nota.serie}`],
    );
  }

  /**
   * Aplica a transição de status de cada código dentro de uma transação com
   * `select ... for update`: o lock serializa chamadas concorrentes pro mesmo
   * pedido e mantém status + evento + estorno + log atômicos.
   */
  private async transicionar(
    codigos: string[],
    opts: {
      statusPermitido: (statusAtual: string) => boolean;
      novoStatus: string;
      detalhe: string;
      operacao: string;
      estornarSaldo?: boolean;
      aposCommit?: (client: import('pg').PoolClient, codigo: string) => Promise<void>;
    },
  ): Promise<ResultadoLote> {
    const { pool } = tenantCtx();
    const processados: string[] = [];
    const ignorados: ResultadoLote['ignorados'] = [];
    for (const codigo of codigos) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const atual = await client.query(
          `select status, cliente_id, valor_saldo_usado from pedidos where id = $1 for update`,
          [codigo],
        );
        if (!atual.rowCount) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'nao_encontrado' });
          continue;
        }
        // Dlinks reenvia o mesmo status várias vezes; sem isso cada envio vira
        // uma linha na linha do tempo do cliente. Esta checagem vem ANTES do
        // statusPermitido de propósito: para FATURADO o guard exige
        // status !== 'FATURADO', então um reenvio caía em 'status_invalido'
        // em vez de ser idempotente (bug visto em 22/09/2026).
        if (atual.rows[0].status === opts.novoStatus) {
          await client.query('rollback');
          processados.push(codigo);
          continue;
        }
        if (!opts.statusPermitido(atual.rows[0].status)) {
          await client.query('rollback');
          ignorados.push({ codigo, motivo: 'status_invalido' });
          continue;
        }
        await client.query(`update pedidos set status = $2 where id = $1`, [codigo, opts.novoStatus]);
        await client.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'erp')`,
          [codigo, opts.novoStatus, opts.detalhe],
        );
        if (opts.estornarSaldo) {
          const valorSaldo = Number(atual.rows[0].valor_saldo_usado) || 0;
          if (valorSaldo > 0) {
            await client.query(
              `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1,$2,'Estorno: pedido cancelado pelo ERP',$3)`,
              [atual.rows[0].cliente_id, valorSaldo, codigo],
            );
          }
        }
        await client.query(
          `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,true)`,
          [opts.operacao, codigo],
        );
        await client.query('commit');
        if (opts.aposCommit) await opts.aposCommit(client, codigo);
        processados.push(codigo);
      } catch (e) {
        await client.query('rollback').catch(() => {});
        this.log.error(`${opts.operacao} falhou pro codigo ${codigo}: ${e}`);
        ignorados.push({ codigo, motivo: 'erro_interno' });
      } finally {
        client.release();
      }
    }
    return { processados, ignorados };
  }
}
