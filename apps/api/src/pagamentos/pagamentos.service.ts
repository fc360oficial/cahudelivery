import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

export interface PagamentoResumo {
  id: string;
  metodo: 'pix' | 'cartao';
  status: 'pendente' | 'pago' | 'expirado' | 'cancelado' | 'falhou';
  valor: number;
  copiaCola: string | null;
  expiraEm: Date;
  pagoEm: Date | null;
}

type Executor = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

function ehPool(e: Executor): e is Pool {
  return typeof (e as Pool).connect === 'function';
}

/**
 * Transições do pagamento. Toda transição usa `where status = 'pendente'`:
 * webhook repetido, consulta concorrente e clique duplo não geram evento duplicado.
 * O pedido segue o pagamento: pago => RECEBIDO (Dlinks passa a ver), expirado => CANCELADO + estorno.
 */
@Injectable()
export class PagamentosService {
  private readonly log = new Logger('PagamentosService');

  /** Roda fn numa transação própria quando recebe um Pool; com PoolClient assume a transação do chamador. */
  private async emTransacao<T>(exec: Executor, fn: (q: Executor) => Promise<T>): Promise<T> {
    if (!ehPool(exec)) return fn(exec);
    const client = await exec.connect();
    try {
      await client.query('begin');
      const r = await fn(client);
      await client.query('commit');
      return r;
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** txid do Itaú: 26–35 chars [A-Za-z0-9]. "PED" + número com 6 dígitos + 20 aleatórios = 29. */
  gerarRef(numero: number): string {
    const aleatorio = randomBytes(15).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 20).padEnd(20, 'X');
    return `PED${String(numero).padStart(6, '0')}${aleatorio}`;
  }

  async criarParaPedido(
    client: Executor,
    provedor: ProvedorPagamento,
    p: { pedidoId: string; numero: number; valor: number; expiracaoSegundos: number; appNome: string },
  ): Promise<PagamentoResumo> {
    const ref = this.gerarRef(p.numero);
    const cob = await provedor.criarCobranca({
      ref,
      valor: p.valor,
      expiracaoSegundos: p.expiracaoSegundos,
      descricao: `Pedido #${p.numero} ${p.appNome}`,
    });
    const { rows } = await client.query(
      `insert into pagamentos (pedido_id, provedor, metodo, status, valor, provedor_ref, copia_cola, expira_em, payload_json)
       values ($1,$2,$3,'pendente',$4,$5,$6,$7,$8) returning id`,
      [p.pedidoId, provedor.nome, provedor.metodo, p.valor, cob.ref, cob.copiaCola, cob.expiraEm, JSON.stringify(cob.payload ?? null)],
    );
    return {
      id: rows[0].id, metodo: provedor.metodo, status: 'pendente', valor: p.valor,
      copiaCola: cob.copiaCola, expiraEm: cob.expiraEm, pagoEm: null,
    };
  }

  /** pendente -> pago. Retorna false se já não estava pendente (idempotente). */
  async confirmarPago(pool: Executor, pagamentoId: string, valorPago: number, pagoEm: Date): Promise<boolean> {
    return this.emTransacao(pool, async (q) => {
      const up = await q.query(
        `update pagamentos set status = 'pago', valor_pago = $2, pago_em = $3, atualizado_em = now()
          where id = $1 and status = 'pendente' returning pedido_id`,
        [pagamentoId, valorPago, pagoEm],
      );
      if (up.rowCount === 0) return false;
      const pedidoId = up.rows[0].pedido_id;
      const upPedido = await q.query(`update pedidos set status = 'RECEBIDO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
      if ((upPedido.rowCount ?? 0) > 0) {
        await q.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'sistema')`,
          [pedidoId, 'RECEBIDO', 'PIX pago'],
        );
      } else {
        this.log.warn(`pagamento ${pagamentoId} pago mas pedido ${pedidoId} não estava em AGUARDANDO_PAGAMENTO`);
      }
      this.log.log(`pagamento ${pagamentoId} pago (pedido ${pedidoId})`);
      return true;
    });
  }

  /** pendente -> expirado; pedido -> CANCELADO; estorna saldo de carteira usado. */
  async expirar(pool: Executor, pagamentoId: string, detalhe: string = 'PIX expirado'): Promise<boolean> {
    return this.emTransacao(pool, async (q) => {
      const up = await q.query(
        `update pagamentos set status = 'expirado', atualizado_em = now()
          where id = $1 and status = 'pendente' returning pedido_id`,
        [pagamentoId],
      );
      if (up.rowCount === 0) return false;
      const pedidoId = up.rows[0].pedido_id;
      const ped = await q.query(`select cliente_id, valor_saldo_usado, numero from pedidos where id = $1`, [pedidoId]);
      const upPedido = await q.query(`update pedidos set status = 'CANCELADO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
      if ((upPedido.rowCount ?? 0) > 0) {
        await q.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO',$2,'sistema')`,
          [pedidoId, detalhe],
        );
      } else {
        this.log.warn(`pagamento ${pagamentoId} expirado mas pedido ${pedidoId} não estava em AGUARDANDO_PAGAMENTO`);
      }
      const saldo = Number(ped.rows[0]?.valor_saldo_usado) || 0;
      if (saldo > 0) {
        await q.query(
          `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1,$2,$3,$4)`,
          [ped.rows[0].cliente_id, saldo, `Estorno: ${detalhe} (pedido #${ped.rows[0].numero})`, pedidoId],
        );
      }
      this.log.log(`pagamento ${pagamentoId} expirado (pedido ${pedidoId})`);
      return true;
    });
  }

  /** Traduz o que o provedor respondeu numa transição. */
  async aplicarSituacao(pool: Executor, pagamento: { id: string; expira_em: Date }, s: SituacaoCobranca): Promise<void> {
    if (s.status === 'pago') {
      await this.confirmarPago(pool, pagamento.id, s.valorPago ?? 0, s.pagoEm ?? new Date());
      return;
    }
    if (s.status === 'expirado') {
      await this.expirar(pool, pagamento.id, 'PIX expirado');
      return;
    }
    if (s.status === 'cancelado') {
      await this.expirar(pool, pagamento.id, 'PIX cancelado no banco');
      return;
    }
    // pendente no provedor, mas já passou do prazo: o Itaú não aceita mais pagamento.
    if (new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id, 'PIX expirado');
    }
  }
}
