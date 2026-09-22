import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { tenantCtx } from '../tenancy/tenant-context';
import { lerNfe } from './nfe-xml.parser';
import { renderizarDanfe } from './danfe.renderer';

export interface NotaGuardada {
  xml: string;
  chave: string;
  numero: string;
}

@Injectable()
export class NotasService {
  private readonly log = new Logger('NotasService');

  private async buscar(pedidoId: string): Promise<NotaGuardada> {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select xml, chave_acesso, numero_nf from pedido_notas where pedido_id = $1`,
      [pedidoId],
    );
    if (!rows[0]?.xml) throw new NotFoundException();
    return { xml: rows[0].xml, chave: rows[0].chave_acesso, numero: rows[0].numero_nf };
  }

  async xml(pedidoId: string): Promise<NotaGuardada> {
    return this.buscar(pedidoId);
  }

  /** Gera o DANFE na hora: volume baixo e nunca entrega PDF de um layout velho. */
  async danfe(pedidoId: string): Promise<{ pdf: Buffer; numero: string }> {
    const nota = await this.buscar(pedidoId);
    try {
      return { pdf: await renderizarDanfe(lerNfe(nota.xml)), numero: nota.numero };
    } catch (e) {
      // Quem abre o link é o cliente no navegador — nunca 500 com stack trace,
      // sempre 404 (mesmo tratamento de "nota não encontrada").
      this.log.error(`falha ao gerar o DANFE do pedido ${pedidoId}: ${e}`);
      throw new NotFoundException();
    }
  }
}
