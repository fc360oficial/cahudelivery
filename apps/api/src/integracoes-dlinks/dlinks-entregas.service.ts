import { Injectable, Logger } from '@nestjs/common';
import { lerNfe, type NotaFiscalLida } from '../notas/nfe-xml.parser';
import { tenantCtx } from '../tenancy/tenant-context';
import { extrairChaveDoXml } from './dlinks-pedidos.service';
import type { ResultadoSync } from './dlinks-sync.service';
import { NotaEntregaDto } from './nota-entrega.dto';

/** Número do XML (texto) ou nulo quando a nota não informa: "0" de volume/peso é "não informado". */
function medida(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

@Injectable()
export class DlinksEntregasService {
  private readonly log = new Logger('DlinksEntregas');

  private async registrarLog(operacao: string, resumo: string, sucesso: boolean) {
    const { pool } = tenantCtx();
    await pool.query(
      `insert into integracao_logs (operacao, direcao, request_resumo, sucesso) values ($1,'erp_para_fluxo',$2,$3)`,
      [operacao, resumo, sucesso],
    );
  }

  /**
   * Notas faturadas de pedidos que não nasceram no Fluxo Commerce (televendas). Upsert pela chave de acesso:
   * reenviar corrige. Cada item é independente: um problema numa nota não derruba as outras do lote.
   *  - FATURADO exige o XML; total, itens, volumes, peso e destinatário saem dele;
   *  - CANCELADO sem XML só marca a nota que já temos;
   *  - nota de pedido do aplicativo/site/Fluxo Vendas é ignorada (ela já chega por /pedidos-faturados).
   */
  async syncNotasEntrega(itens: NotaEntregaDto[]): Promise<ResultadoSync> {
    const { pool } = tenantCtx();
    const ignorados: ResultadoSync['ignorados'] = [];
    let processados = 0;

    for (const item of itens) {
      const nf = item.nota_fiscal;
      const status = item.status ?? 'FATURADO';
      // O item devolvido em `ignorados` nunca leva o XML de volta (pode ter 2 MB).
      const resumo = { chave: nf.chave, numero: nf.numero, serie: nf.serie, pedido_numero: item.pedido_numero ?? null, status };

      const doFluxo = await pool.query(`select 1 from pedido_notas where chave_acesso = $1 limit 1`, [nf.chave]);
      if (doFluxo.rowCount) {
        ignorados.push({ item: resumo, motivo: 'nota_de_pedido_do_fluxo' });
        continue;
      }

      if (!nf.xml_base64) {
        if (status !== 'CANCELADO') {
          ignorados.push({ item: resumo, motivo: 'xml_ausente' });
          continue;
        }
        const up = await pool.query(
          `update notas_entrega set status = 'CANCELADO', atualizada_em = now() where chave_acesso = $1`,
          [nf.chave],
        );
        if (!up.rowCount) {
          ignorados.push({ item: resumo, motivo: 'nota_nao_encontrada' });
          continue;
        }
        processados++;
        continue;
      }

      const xml = Buffer.from(nf.xml_base64, 'base64').toString('utf8');
      const chaveXml = extrairChaveDoXml(xml);
      if (!chaveXml) {
        ignorados.push({ item: resumo, motivo: 'xml_invalido' });
        continue;
      }
      if (chaveXml !== nf.chave) {
        ignorados.push({ item: resumo, motivo: 'chave_divergente' });
        continue;
      }
      let nota: NotaFiscalLida;
      try {
        nota = lerNfe(xml);
      } catch (e) {
        this.log.warn(`nota ${nf.chave}: XML não pôde ser lido (${e})`);
        ignorados.push({ item: resumo, motivo: 'xml_invalido' });
        continue;
      }

      let clienteId: string | null = null;
      if (item.cliente_codigo) {
        const cli = await pool.query(`select id from clientes where erp_cliente_id = $1`, [item.cliente_codigo]);
        clienteId = cli.rows[0]?.id ?? null;
      }

      const itensNota = nota.itens.map((i) => ({
        codigo: i.codigo,
        descricao: i.descricao,
        unidade: i.unidade,
        quantidade: i.quantidade,
        valorUnitario: i.valorUnitario,
        valorTotal: i.valorTotal,
      }));
      const emitidaEm = nf.emitida_em ?? (nota.emissaoEm.getTime() > 0 ? nota.emissaoEm.toISOString() : null);

      await pool.query(
        `insert into notas_entrega (chave_acesso, numero_nf, serie, pedido_numero, origem, cliente_id, cliente_codigo,
                                    tipo_entrega, status, total, volumes, peso_bruto_kg, destinatario_json, itens_json,
                                    xml, emitida_em)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         on conflict (chave_acesso) do update set
           numero_nf = excluded.numero_nf, serie = excluded.serie, pedido_numero = excluded.pedido_numero,
           origem = excluded.origem, cliente_id = excluded.cliente_id, cliente_codigo = excluded.cliente_codigo,
           tipo_entrega = excluded.tipo_entrega, status = excluded.status, total = excluded.total,
           volumes = excluded.volumes, peso_bruto_kg = excluded.peso_bruto_kg,
           destinatario_json = excluded.destinatario_json, itens_json = excluded.itens_json,
           xml = excluded.xml, emitida_em = excluded.emitida_em, atualizada_em = now()`,
        [
          nf.chave,
          nf.numero,
          nf.serie,
          item.pedido_numero?.trim() || null,
          item.origem?.trim().toLowerCase() || 'televendas',
          clienteId,
          item.cliente_codigo ?? null,
          item.tipo_entrega ?? 'entrega',
          status,
          nota.totais.valorTotal,
          medida(nota.volumes?.quantidade),
          medida(nota.volumes?.pesoBruto),
          JSON.stringify(nota.destinatario),
          JSON.stringify(itensNota),
          xml,
          emitidaEm,
        ],
      );
      processados++;
    }

    await this.registrarLog(
      'sync_notas_entrega',
      `${processados} nota(s) de entrega, ${ignorados.length} ignorada(s)`,
      ignorados.length === 0,
    );
    return { processados, ignorados };
  }
}
