import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DadosCartao, ProvedorCartao, ProvedorPagamento, SituacaoCobranca, ehProvedorCartao } from './provedor-pagamento';

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
  // pg Client também tem connect(), então checar só isso classifica um PoolClient/Client
  // errado como Pool. 'release' existe em PoolClient mas não em Pool — é o que distingue de fato.
  return !('release' in e) && typeof (e as Pool).connect === 'function';
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
    // Cada provedor tem seu formato de referência (e.Rede: até 16 alfanuméricos).
    const ref = ehProvedorCartao(provedor) ? provedor.novaRef(p.numero) : this.gerarRef(p.numero);
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
  async confirmarPago(pool: Executor, pagamentoId: string, valorPago: number, pagoEm: Date, detalhe: string = 'PIX pago'): Promise<boolean> {
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
          [pedidoId, 'RECEBIDO', detalhe],
        );
        // Pedido PIX online só entra na outbox (e portanto no ERP) depois de pago — evita
        // que o Dlinks veja um pedido AGUARDANDO_PAGAMENTO que ainda pode expirar/cancelar.
        await q.query(
          `insert into sync_outbox (agregado, agregado_id, evento, payload_json) values ('pedido',$1,'pedido_criado','{}')`,
          [pedidoId],
        );
      } else {
        this.log.error(`pagamento ${pagamentoId} pago mas pedido ${pedidoId} ja estava fora de AGUARDANDO_PAGAMENTO (possivel estorno manual)`);
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

  /**
   * Traduz o que o provedor respondeu numa transição.
   * `expirarSeVencido` (default true) controla só o ramo "pendente no provedor mas já passou
   * do prazo local": o caminho do webhook chama com `false` porque um webhook é evidência de
   * que dinheiro se moveu — nunca expira localmente por causa dele; quem decide expirar por
   * prazo vencido é sempre o worker, que consulta por iniciativa própria.
   */
  async aplicarSituacao(
    pool: Executor,
    pagamento: { id: string; expira_em: Date; metodo?: string },
    s: SituacaoCobranca,
    opts: { expirarSeVencido?: boolean } = {},
  ): Promise<void> {
    const cartao = pagamento.metodo === 'cartao';
    if (s.status === 'pago') {
      await this.confirmarPago(pool, pagamento.id, s.valorPago ?? 0, s.pagoEm ?? new Date(), cartao ? 'Cartão aprovado' : 'PIX pago');
      return;
    }
    if (s.status === 'expirado') {
      await this.expirar(pool, pagamento.id, cartao ? 'Pagamento com cartão expirado' : 'PIX expirado');
      return;
    }
    if (s.status === 'cancelado') {
      await this.expirar(pool, pagamento.id, cartao ? 'Pagamento com cartão cancelado no provedor' : 'PIX cancelado no banco');
      return;
    }
    // pendente no provedor, mas já passou do prazo: não aceita mais pagamento.
    if (opts.expirarSeVencido !== false && new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id, cartao ? 'Pagamento com cartão expirado' : 'PIX expirado');
    }
  }

  /**
   * Cobra o cartão de um pagamento pendente. Recusa do emissor NÃO encerra o
   * pagamento: o cliente pode tentar outro cartão até a janela (expira_em) vencer.
   * Advisory lock por pagamento: clique duplo não pode virar cobrança dupla.
   */
  async pagarComCartao(
    pool: Pool,
    provedor: ProvedorCartao,
    pagamento: { id: string; numero: number; valor: number; expira_em: Date },
    cartao: DadosCartao,
  ): Promise<{ status: 'pago' | 'recusado' | 'expirado' | 'processando'; codigo?: string; mensagem?: string }> {
    if (new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id, 'Pagamento com cartão expirado');
      return { status: 'expirado' };
    }
    const client = await pool.connect();
    try {
      const lk = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [pagamento.id]);
      if (!lk.rows[0]?.ok) return { status: 'processando' };
      // Antes de nova tentativa, confere a anterior: um timeout aqui pode ter sido
      // aprovado lá — cobrar de novo sem checar seria cobrança dupla no cartão.
      const atual = await client.query(`select provedor_ref, status from pagamentos where id = $1`, [pagamento.id]);
      if (atual.rows[0]?.status === 'pago') return { status: 'pago' };
      if (atual.rows[0]?.provedor_ref) {
        // Se o provedor está fora do ar pra consultar, não arrisca cobrar às cegas:
        // a exceção sobe e o cliente tenta de novo quando o provedor voltar.
        const s = await provedor.consultar(atual.rows[0].provedor_ref);
        if (s.status === 'pago') {
          await this.confirmarPago(pool, pagamento.id, s.valorPago ?? pagamento.valor, s.pagoEm ?? new Date(), 'Cartão aprovado');
          return { status: 'pago' };
        }
      }
      // Referência nova por tentativa: a e.Rede não aceita reference repetida (nem de recusa).
      // O worker consulta sempre a última, então a ref gravada acompanha a tentativa corrente.
      const ref = provedor.novaRef(pagamento.numero);
      const up = await client.query(
        `update pagamentos set provedor_ref = $2, atualizado_em = now() where id = $1 and status = 'pendente'`,
        [pagamento.id, ref],
      );
      if (up.rowCount === 0) {
        // pagou/expirou no meio (worker ou outra sessão)
        const st = await client.query(`select status from pagamentos where id = $1`, [pagamento.id]);
        return st.rows[0]?.status === 'pago' ? { status: 'pago' } : { status: 'expirado' };
      }
      const r = await provedor.cobrar(ref, pagamento.valor, cartao);
      await client.query(`update pagamentos set payload_json = $2, atualizado_em = now() where id = $1`, [
        pagamento.id,
        JSON.stringify(r.payload ?? null),
      ]);
      if (r.aprovado) {
        await this.confirmarPago(pool, pagamento.id, pagamento.valor, new Date(), 'Cartão aprovado');
        return { status: 'pago' };
      }
      this.log.log(`cartão recusado (pagamento ${pagamento.id}, codigo ${r.codigo})`);
      return { status: 'recusado', codigo: r.codigo, mensagem: r.mensagem };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [pagamento.id]).catch(() => {});
      client.release();
    }
  }
}
