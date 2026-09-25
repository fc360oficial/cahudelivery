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

/**
 * Transições do pagamento. Toda transição usa `where status = 'pendente'`:
 * webhook repetido, consulta concorrente e clique duplo não geram evento duplicado.
 * O pedido segue o pagamento: pago => RECEBIDO (Dlinks passa a ver), expirado => CANCELADO + estorno.
 */
@Injectable()
export class PagamentosService {
  private readonly log = new Logger('PagamentosService');

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
    const up = await pool.query(
      `update pagamentos set status = 'pago', valor_pago = $2, pago_em = $3, atualizado_em = now()
        where id = $1 and status = 'pendente' returning pedido_id`,
      [pagamentoId, valorPago, pagoEm],
    );
    if (up.rowCount === 0) return false;
    const pedidoId = up.rows[0].pedido_id;
    await pool.query(`update pedidos set status = 'RECEBIDO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'sistema')`,
      [pedidoId, 'RECEBIDO', 'PIX pago'],
    );
    this.log.log(`pagamento ${pagamentoId} pago (pedido ${pedidoId})`);
    return true;
  }

  /** pendente -> expirado; pedido -> CANCELADO; estorna saldo de carteira usado. */
  async expirar(pool: Executor, pagamentoId: string): Promise<boolean> {
    const up = await pool.query(
      `update pagamentos set status = 'expirado', atualizado_em = now()
        where id = $1 and status = 'pendente' returning pedido_id`,
      [pagamentoId],
    );
    if (up.rowCount === 0) return false;
    const pedidoId = up.rows[0].pedido_id;
    const ped = await pool.query(`select cliente_id, valor_saldo_usado, numero from pedidos where id = $1`, [pedidoId]);
    await pool.query(`update pedidos set status = 'CANCELADO' where id = $1 and status = 'AGUARDANDO_PAGAMENTO'`, [pedidoId]);
    await pool.query(
      `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'CANCELADO','PIX expirado','sistema')`,
      [pedidoId],
    );
    const saldo = Number(ped.rows[0]?.valor_saldo_usado) || 0;
    if (saldo > 0) {
      await pool.query(
        `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id) values ($1,$2,$3,$4)`,
        [ped.rows[0].cliente_id, saldo, `Estorno: PIX expirado (pedido #${ped.rows[0].numero})`, pedidoId],
      );
    }
    this.log.log(`pagamento ${pagamentoId} expirado (pedido ${pedidoId})`);
    return true;
  }

  /** Traduz o que o provedor respondeu numa transição. */
  async aplicarSituacao(pool: Executor, pagamento: { id: string; expira_em: Date }, s: SituacaoCobranca): Promise<void> {
    if (s.status === 'pago') {
      await this.confirmarPago(pool, pagamento.id, s.valorPago ?? 0, s.pagoEm ?? new Date());
      return;
    }
    if (s.status === 'expirado' || s.status === 'cancelado') {
      await this.expirar(pool, pagamento.id);
      return;
    }
    // pendente no provedor, mas já passou do prazo: o Itaú não aceita mais pagamento.
    if (new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id);
    }
  }
}
