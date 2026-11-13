import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { Contexto3ds, DadosCartao, ProvedorCartao, ProvedorPagamento, SituacaoCobranca, ehProvedorCartao } from './provedor-pagamento';

export interface PagamentoResumo {
  id: string;
  metodo: 'pix' | 'cartao';
  status: 'pendente' | 'pago' | 'expirado' | 'cancelado' | 'falhou' | 'estorno_solicitado' | 'estornado';
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
    // Pré-autorização ligada no provedor: este pagamento só reserva no checkout e é
    // cobrado pelo valor da NF-e no faturamento. Fica gravado por pagamento — desligar
    // a chave depois não muda como os já reservados são tratados.
    const captura = ehProvedorCartao(provedor) && provedor.preAutorizacao ? 'posterior' : 'automatica';
    const { rows } = await client.query(
      `insert into pagamentos (pedido_id, provedor, metodo, status, valor, provedor_ref, copia_cola, expira_em, payload_json, captura)
       values ($1,$2,$3,'pendente',$4,$5,$6,$7,$8,$9) returning id`,
      [p.pedidoId, provedor.nome, provedor.metodo, p.valor, cob.ref, cob.copiaCola, cob.expiraEm, JSON.stringify(cob.payload ?? null), captura],
    );
    return {
      id: rows[0].id, metodo: provedor.metodo, status: 'pendente', valor: p.valor,
      copiaCola: cob.copiaCola, expiraEm: cob.expiraEm, pagoEm: null,
    };
  }

  /**
   * pendente -> pago (ou -> autorizado, quando `soReserva`: pré-autorização, o
   * dinheiro só sai no faturamento). Nos dois casos o pedido segue pro ERP.
   * Retorna false se já não estava pendente (idempotente).
   */
  async confirmarPago(
    pool: Executor,
    pagamentoId: string,
    valorPago: number,
    pagoEm: Date,
    detalhe: string = 'PIX pago',
    cartao: { tid?: string; codigo3ds?: string; soReserva?: boolean } = {},
  ): Promise<boolean> {
    return this.emTransacao(pool, async (q) => {
      const up = cartao.soReserva
        ? await q.query(
            `update pagamentos set status = 'autorizado', autorizado_em = $2, atualizado_em = now(),
                    provedor_tid = coalesce($3, provedor_tid), autenticacao_3ds = coalesce($4, autenticacao_3ds)
              where id = $1 and status = 'pendente' returning pedido_id`,
            [pagamentoId, pagoEm, cartao.tid ?? null, cartao.codigo3ds ?? null],
          )
        : await q.query(
            `update pagamentos set status = 'pago', valor_pago = $2, pago_em = $3, atualizado_em = now(),
                    provedor_tid = coalesce($4, provedor_tid), autenticacao_3ds = coalesce($5, autenticacao_3ds)
              where id = $1 and status = 'pendente' returning pedido_id`,
            [pagamentoId, valorPago, pagoEm, cartao.tid ?? null, cartao.codigo3ds ?? null],
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

  /**
   * PIX pago DEPOIS de o sistema dar o pagamento por vencido (o dinheiro entrou):
   * expirado -> pago, e o pedido CONTINUA cancelado — o worker (creditosPix) credita
   * o valor na carteira do cliente. Nunca reativa nem manda pro ERP sozinho: o ERP
   * também vê pedido cancelado e alguém pode já ter tratado lá (Tiago excluiu o #12
   * no ERP em 30/10/2026 — reativar o recriaria).
   */
  async registrarPagoAposVencer(pool: Executor, pagamentoId: string, valorPago: number, pagoEm: Date): Promise<boolean> {
    return this.emTransacao(pool, async (q) => {
      const up = await q.query(
        `update pagamentos set status = 'pago', valor_pago = $2, pago_em = $3, atualizado_em = now()
          where id = $1 and status = 'expirado' returning pedido_id`,
        [pagamentoId, valorPago, pagoEm],
      );
      if (up.rowCount === 0) return false;
      const pedidoId = up.rows[0].pedido_id;
      await q.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem)
         select $1, status, 'PIX recebido depois do prazo — o pedido segue cancelado e o valor vira crédito na carteira', 'sistema'
           from pedidos where id = $1`,
        [pedidoId],
      );
      this.log.warn(`PIX ${pagamentoId} pago após vencer (pedido ${pedidoId}): vira crédito na carteira`);
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
    pagamento: { id: string; expira_em: Date; metodo?: string; captura?: string },
    s: SituacaoCobranca,
    opts: { expirarSeVencido?: boolean } = {},
  ): Promise<void> {
    const cartao = pagamento.metodo === 'cartao';
    if (s.status === 'pago') {
      // Reserva aprovada (pré-autorização) ainda sem cobrança: vira 'autorizado', não 'pago'.
      const soReserva = pagamento.captura === 'posterior' && s.capturado !== true;
      await this.confirmarPago(
        pool, pagamento.id, s.valorPago ?? 0, s.pagoEm ?? new Date(),
        cartao ? (soReserva ? 'Cartão aprovado (valor reservado; cobra o valor da nota)' : 'Cartão aprovado') : 'PIX pago',
        { tid: s.tid, codigo3ds: s.codigo3ds, soReserva },
      );
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
   * Tudo roda na conexão que segura a trava (de sessão): a confirmação do aprovado é uma
   * transação explícita nela (begin/commit), nunca uma segunda conexão do pool — com ~10
   * aprovações ao mesmo tempo o pool de 10 travava esperando a si mesmo. A chamada ao provedor
   * fica fora dessa transação.
   */
  async pagarComCartao(
    pool: Pool,
    provedor: ProvedorCartao,
    pagamento: { id: string; numero: number; valor: number; expira_em: Date },
    cartao: DadosCartao,
    ctx3ds?: Contexto3ds,
  ): Promise<{
    status: 'pago' | 'recusado' | 'expirado' | 'processando' | 'autenticar';
    codigo?: string;
    mensagem?: string;
    urlAutenticacao?: string;
  }> {
    if (new Date(pagamento.expira_em).getTime() < Date.now()) {
      await this.expirar(pool, pagamento.id, 'Pagamento com cartão expirado');
      return { status: 'expirado' };
    }
    const client = await pool.connect();
    // Rollback que falhou deixa a sessão num estado incerto (talvez ainda em transação, com a
    // trava): a conexão é descartada em vez de voltar ao pool. Fechar a sessão solta a trava.
    let conexaoIncerta: Error | undefined;
    const confirmarNaConexao = async (
      pagamentoId: string, valorPago: number, pagoEm: Date, detalhe: string,
      dadosCartao: { tid?: string; codigo3ds?: string; soReserva?: boolean },
    ): Promise<boolean> => {
      await client.query('begin');
      try {
        // Com PoolClient, confirmarPago roda na transação do chamador (emTransacao não abre outra).
        const ok = await this.confirmarPago(client, pagamentoId, valorPago, pagoEm, detalhe, dadosCartao);
        await client.query('commit');
        return ok;
      } catch (e) {
        await client.query('rollback').catch((erro: Error) => {
          conexaoIncerta = erro;
        });
        throw e;
      }
    };
    try {
      const lk = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [pagamento.id]);
      if (!lk.rows[0]?.ok) return { status: 'processando' };
      // Antes de nova tentativa, confere a anterior: um timeout aqui pode ter sido
      // aprovado lá — cobrar de novo sem checar seria cobrança dupla no cartão.
      const atual = await client.query(
        `select provedor_ref, status, autenticacao_3ds, payload_json->'threeDSecure'->>'url' as url_3ds,
                atualizado_em > now() - interval '10 minutes' as desafio_recente, captura
           from pagamentos where id = $1`,
        [pagamento.id],
      );
      // Pro app, reserva aprovada (pré-autorização) também é "pago": o pedido seguiu.
      if (atual.rows[0]?.status === 'pago' || atual.rows[0]?.status === 'autorizado') return { status: 'pago' };
      const reserva = atual.rows[0]?.captura === 'posterior';
      const detalheAprovado = reserva ? 'Cartão aprovado (valor reservado; cobra o valor da nota)' : 'Cartão aprovado';
      if (atual.rows[0]?.provedor_ref) {
        // Se o provedor está fora do ar pra consultar, não arrisca cobrar às cegas:
        // a exceção sobe e o cliente tenta de novo quando o provedor voltar.
        const s = await provedor.consultar(atual.rows[0].provedor_ref);
        if (s.status === 'pago') {
          await confirmarNaConexao(pagamento.id, s.valorPago ?? pagamento.valor, s.pagoEm ?? new Date(), detalheAprovado, {
            tid: s.tid, codigo3ds: s.codigo3ds, soReserva: reserva && s.capturado !== true,
          });
          return { status: 'pago' };
        }
        // Desafio 3DS da tentativa anterior ainda aberto (não negado, < 10 min):
        // cobrar de novo agora podia virar cobrança dupla se o cliente concluir o
        // desafio antigo numa aba esquecida. Reabre o mesmo desafio.
        const a = atual.rows[0];
        if (a.autenticacao_3ds === '220' && a.url_3ds && a.desafio_recente && !s.negada) {
          return { status: 'autenticar', urlAutenticacao: a.url_3ds, mensagem: 'Conclua a confirmação da compra no seu banco' };
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
        return st.rows[0]?.status === 'pago' || st.rows[0]?.status === 'autorizado' ? { status: 'pago' } : { status: 'expirado' };
      }
      const r = await provedor.cobrar(ref, pagamento.valor, cartao, ctx3ds, { capturar: !reserva });
      await client.query(
        // autenticacao_3ds é da tentativa corrente (sem coalesce): um '220' antigo não pode
        // continuar travando novas tentativas depois que outra já respondeu.
        `update pagamentos set payload_json = $2, autenticacao_3ds = $3, atualizado_em = now() where id = $1`,
        [pagamento.id, JSON.stringify(r.payload ?? null), r.codigo3ds ?? null],
      );
      if (r.aprovado) {
        await confirmarNaConexao(pagamento.id, pagamento.valor, new Date(), detalheAprovado, {
          tid: r.tid, codigo3ds: r.codigo3ds, soReserva: reserva,
        });
        return { status: 'pago' };
      }
      if (r.urlAutenticacao) {
        // Pagamento segue pendente: a Rede autoriza depois do desafio e o app
        // (ou o worker) confirma consultando pela ref desta tentativa.
        return { status: 'autenticar', urlAutenticacao: r.urlAutenticacao, mensagem: r.mensagem };
      }
      this.log.log(`cartão recusado (pagamento ${pagamento.id}, codigo ${r.codigo}, 3ds ${r.codigo3ds ?? '-'})`);
      return { status: 'recusado', codigo: r.codigo, mensagem: r.mensagem };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [pagamento.id]).catch(() => {});
      client.release(conexaoIncerta);
    }
  }

  /**
   * Estorna (total ou parcial) um pagamento de cartão aprovado na Rede.
   * `valor` ausente = o que ainda não foi estornado. Advisory lock por pagamento
   * + checagem do que já foi pedido: clique duplo, worker e retaguarda ao mesmo
   * tempo nunca viram dois estornos. Cada tentativa vira uma linha em
   * pagamento_estornos (é o que a retaguarda mostra e o worker reprocessa).
   */
  async estornarCartao(
    pool: Pool,
    provedor: ProvedorCartao,
    pagamentoId: string,
    opts: { valor?: number; motivo: string; origem: 'erp' | 'retaguarda' | 'sistema'; usuarioAdminId?: string },
  ): Promise<{ status: 'concluido' | 'solicitado' | 'falhou' | 'nada_a_estornar' | 'processando'; mensagem: string; valor?: number }> {
    const client = await pool.connect();
    const chave = `estorno:${pagamentoId}`;
    try {
      const lk = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [chave]);
      if (!lk.rows[0]?.ok) return { status: 'processando', mensagem: 'Estorno já em andamento' };
      const { rows } = await client.query(
        `select g.id, g.pedido_id, g.status, g.metodo, g.valor, g.valor_pago, g.provedor_ref, g.provedor_tid, p.numero,
                coalesce((select sum(e.valor) from pagamento_estornos e
                           where e.pagamento_id = g.id and e.status in ('solicitado','concluido')), 0) as ja_estornado
           from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1`,
        [pagamentoId],
      );
      const g = rows[0];
      if (!g || g.metodo !== 'cartao') return { status: 'falhou', mensagem: 'Pagamento não é de cartão' };
      if (g.status !== 'pago' && g.status !== 'estorno_solicitado') {
        return { status: 'nada_a_estornar', mensagem: g.status === 'estornado' ? 'Pagamento já estornado' : 'Pagamento não foi aprovado' };
      }
      const pago = Number(g.valor_pago ?? g.valor);
      const disponivel = Number((pago - Number(g.ja_estornado)).toFixed(2));
      const valor = Number((opts.valor ?? disponivel).toFixed(2));
      if (disponivel <= 0) return { status: 'nada_a_estornar', mensagem: 'Nada a estornar: o valor pago já foi devolvido' };
      if (!(valor > 0) || valor > disponivel) {
        return { status: 'falhou', mensagem: `Valor inválido: dá pra estornar até R$ ${disponivel.toFixed(2)}` };
      }

      let tid: string | null = g.provedor_tid;
      if (!tid && g.provedor_ref) {
        // Pagamento aprovado antes de guardarmos o tid: recupera na consulta por reference.
        const s = await provedor.consultar(g.provedor_ref);
        tid = s.tid ?? null;
        if (tid) await client.query(`update pagamentos set provedor_tid = $2 where id = $1`, [g.id, tid]);
      }
      if (!tid) return { status: 'falhou', mensagem: 'Transação não encontrada na Rede (sem tid) — estornar pelo portal useRede' };

      const r = await provedor.estornar(tid, valor);
      await client.query(
        `insert into pagamento_estornos (pagamento_id, valor, status, refund_id, codigo, mensagem, tentar_de_novo, motivo, origem, usuario_admin_id, payload_json)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [g.id, valor, r.status, r.refundId ?? null, r.codigo, r.mensagem, r.tentarDeNovo === true, opts.motivo, opts.origem,
         opts.usuarioAdminId ?? null, JSON.stringify(r.payload ?? null)],
      );
      if (r.status !== 'falhou') {
        const total = valor >= disponivel;
        const novoStatus = r.status === 'concluido' ? (total ? 'estornado' : g.status) : 'estorno_solicitado';
        await client.query(`update pagamentos set status = $2, atualizado_em = now() where id = $1`, [g.id, novoStatus]);
        await client.query(
          `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,(select status from pedidos where id = $1),$2,$3)`,
          [g.pedido_id,
           `${r.status === 'concluido' ? 'Estorno do cartão feito' : 'Estorno do cartão solicitado à Rede'}: R$ ${valor.toFixed(2).replace('.', ',')} (${opts.motivo})`,
           opts.origem === 'erp' ? 'sistema' : opts.origem],
        );
      }
      this.log.log(`estorno ${r.status} pagamento ${g.id} pedido #${g.numero} valor ${valor} codigo ${r.codigo}`);
      return { status: r.status, mensagem: r.mensagem, valor };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [chave]).catch(() => {});
      client.release();
    }
  }

  /**
   * Pré-autorização: cobra a reserva. `valor` ausente = valor da NF-e (ou o
   * reservado, se ainda não há nota); nunca passa do reservado. Lock por
   * pagamento: worker e retaguarda nunca cobram duas vezes. Se a Rede não
   * responder direito, confere pela consulta antes de dar como falha (a Rede
   * pede pra nunca repetir captura sem a resposta da anterior).
   */
  async cobrarReserva(
    pool: Pool,
    provedor: ProvedorCartao,
    pagamentoId: string,
    opts: { valor?: number; motivo: string; origem: 'sistema' | 'retaguarda'; usuarioAdminId?: string },
  ): Promise<{ status: 'cobrado' | 'falhou' | 'nada' | 'processando'; mensagem: string; valor?: number }> {
    const client = await pool.connect();
    const chave = `captura:${pagamentoId}`;
    try {
      const lk = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [chave]);
      if (!lk.rows[0]?.ok) return { status: 'processando', mensagem: 'Cobrança já em andamento' };
      const { rows } = await client.query(
        `select g.id, g.pedido_id, g.status, g.valor, g.provedor_ref, g.provedor_tid, p.numero, p.status as pedido_status,
                (select f.total from pedido_faturamentos f where f.pedido_id = p.id) as faturado
           from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1`,
        [pagamentoId],
      );
      const g = rows[0];
      if (!g || g.status !== 'autorizado') return { status: 'nada', mensagem: 'Pagamento não está reservado' };
      if (g.pedido_status === 'CANCELADO') return { status: 'nada', mensagem: 'Pedido cancelado: a reserva deve ser liberada, não cobrada' };
      const reservado = Number(g.valor);
      const alvo = opts.valor ?? (g.faturado != null ? Number(g.faturado) : reservado);
      const valor = Number(Math.min(alvo, reservado).toFixed(2));
      if (!(valor > 0)) return { status: 'falhou', mensagem: 'Valor a cobrar inválido' };

      let tid: string | null = g.provedor_tid;
      if (!tid && g.provedor_ref) {
        const s = await provedor.consultar(g.provedor_ref);
        tid = s.tid ?? null;
        if (tid) await client.query(`update pagamentos set provedor_tid = $2 where id = $1`, [g.id, tid]);
      }
      if (!tid) return { status: 'falhou', mensagem: 'Transação não encontrada na Rede (sem tid)' };

      const r = await provedor.capturar(tid, valor);
      let cobrado = r.ok ? valor : null;
      if (!r.ok && g.provedor_ref) {
        // Resposta ruim nem sempre é "não cobrou": confere na Rede antes de marcar falha.
        const s = await provedor.consultar(g.provedor_ref).catch(() => null);
        if (s?.capturado) cobrado = s.valorCapturado ?? valor;
      }
      if (cobrado == null) {
        await client.query(`update pagamentos set captura_erro = $2, atualizado_em = now() where id = $1`, [
          g.id, `${r.codigo ? `${r.codigo}: ` : ''}${r.mensagem}`.slice(0, 300),
        ]);
        this.log.warn(`cobrança da reserva falhou (pagamento ${g.id}, pedido #${g.numero}): ${r.codigo} ${r.mensagem}`);
        return { status: 'falhou', mensagem: r.mensagem };
      }
      await client.query(
        `update pagamentos set status = 'pago', valor_pago = $2, pago_em = now(), captura_erro = null, atualizado_em = now()
          where id = $1 and status = 'autorizado'`,
        [g.id, cobrado],
      );
      const sobra = reservado - cobrado;
      const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`;
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,$4)`,
        [g.pedido_id, g.pedido_status,
         `Cartão cobrado: ${brl(cobrado)} (${opts.motivo})${sobra >= 0.01 ? ` — ${brl(sobra)} da reserva não foram cobrados` : ''}`,
         opts.origem],
      );
      this.log.log(`reserva cobrada pagamento ${g.id} pedido #${g.numero}: ${cobrado} de ${reservado}`);
      return { status: 'cobrado', mensagem: `Cobrado ${brl(cobrado)}`, valor: cobrado };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [chave]).catch(() => {});
      client.release();
    }
  }

  /**
   * Pré-autorização de pedido cancelado: libera o limite do cliente (cancelamento
   * da autorização na Rede, mesmo endpoint do estorno). Nada chega à fatura.
   */
  async liberarReserva(
    pool: Pool,
    provedor: ProvedorCartao,
    pagamentoId: string,
    opts: { motivo: string; origem: 'sistema' | 'retaguarda'; usuarioAdminId?: string },
  ): Promise<{ status: 'liberado' | 'falhou' | 'nada' | 'processando'; mensagem: string }> {
    const client = await pool.connect();
    const chave = `captura:${pagamentoId}`; // mesma chave da cobrança: nunca cobra e libera ao mesmo tempo
    try {
      const lk = await client.query('select pg_try_advisory_lock(hashtext($1)) as ok', [chave]);
      if (!lk.rows[0]?.ok) return { status: 'processando', mensagem: 'Operação já em andamento' };
      const { rows } = await client.query(
        `select g.id, g.pedido_id, g.status, g.valor, g.provedor_ref, g.provedor_tid, p.status as pedido_status
           from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1`,
        [pagamentoId],
      );
      const g = rows[0];
      if (!g || g.status !== 'autorizado') return { status: 'nada', mensagem: 'Pagamento não está reservado' };
      let tid: string | null = g.provedor_tid;
      if (!tid && g.provedor_ref) tid = (await provedor.consultar(g.provedor_ref)).tid ?? null;
      if (!tid) return { status: 'falhou', mensagem: 'Transação não encontrada na Rede (sem tid)' };
      const r = await provedor.estornar(tid, Number(g.valor));
      await client.query(
        `insert into pagamento_estornos (pagamento_id, valor, destino, status, refund_id, codigo, mensagem, tentar_de_novo, motivo, origem, usuario_admin_id, payload_json)
         values ($1,$2,'cartao',$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [g.id, g.valor, r.status, r.refundId ?? null, r.codigo, r.mensagem, r.tentarDeNovo === true,
         `Reserva liberada: ${opts.motivo}`, opts.origem, opts.usuarioAdminId ?? null, JSON.stringify(r.payload ?? null)],
      );
      if (r.status === 'falhou') {
        await client.query(`update pagamentos set captura_erro = $2, atualizado_em = now() where id = $1`, [g.id, `liberar: ${r.mensagem}`.slice(0, 300)]);
        return { status: 'falhou', mensagem: r.mensagem };
      }
      await client.query(`update pagamentos set status = 'cancelado', captura_erro = null, atualizado_em = now() where id = $1`, [g.id]);
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,$4)`,
        [g.pedido_id, g.pedido_status, `Reserva do cartão liberada, nada foi cobrado (${opts.motivo})`, opts.origem],
      );
      return { status: 'liberado', mensagem: 'Reserva liberada no cartão do cliente' };
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [chave]).catch(() => {});
      client.release();
    }
  }

  /**
   * PIX devolvido vira crédito na carteira do app, na hora (padrão da política).
   * - 'cancelado': pedido cancelado → credita tudo o que foi pago e ainda não voltou;
   * - 'diferenca': faturou menos que o pedido → credita (pago + saldo usado − faturado − já devolvido).
   * Linha travada (for update) + cálculo dentro da transação: worker e retaguarda
   * ao mesmo tempo nunca creditam duas vezes. O cliente que preferir o dinheiro
   * pede pelo WhatsApp e a retaguarda registra com registrarDevolucaoPix.
   */
  async creditarPixNaCarteira(
    pool: Pool,
    pagamentoId: string,
    opts: { modo: 'cancelado' | 'diferenca'; origem: 'sistema' | 'retaguarda'; usuarioAdminId?: string },
  ): Promise<{ creditado: number }> {
    return this.emTransacao(pool, async (q) => {
      const { rows } = await q.query(
        `select g.id, g.pedido_id, g.status, g.metodo, g.valor, g.valor_pago, p.numero, p.cliente_id, p.status as pedido_status,
                p.valor_saldo_usado, (select f.total from pedido_faturamentos f where f.pedido_id = p.id) as faturado,
                coalesce((select sum(e.valor) from pagamento_estornos e
                           where e.pagamento_id = g.id and e.status in ('solicitado','concluido')), 0) as ja_devolvido
           from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1 for update of g`,
        [pagamentoId],
      );
      const g = rows[0];
      if (!g || g.metodo !== 'pix' || g.status !== 'pago') return { creditado: 0 };
      const pago = Number(g.valor_pago ?? g.valor);
      const disponivel = pago - Number(g.ja_devolvido);
      let valor: number;
      if (opts.modo === 'cancelado') {
        if (g.pedido_status !== 'CANCELADO') return { creditado: 0 };
        valor = disponivel;
      } else {
        if (g.faturado == null) return { creditado: 0 };
        valor = Math.min(disponivel, pago + Number(g.valor_saldo_usado || 0) - Number(g.faturado) - Number(g.ja_devolvido));
      }
      valor = Number(valor.toFixed(2));
      if (valor < 0.01) return { creditado: 0 };
      const motivo = opts.modo === 'cancelado'
        ? `Crédito do PIX do pedido #${g.numero} (pedido cancelado)`
        : `Crédito da diferença do pedido #${g.numero} (faturado menor que o pago)`;
      await q.query(
        `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id, criado_por) values ($1,$2,$3,$4,$5)`,
        [g.cliente_id, valor, motivo, g.pedido_id, opts.usuarioAdminId ?? null],
      );
      await q.query(
        `insert into pagamento_estornos (pagamento_id, valor, destino, status, motivo, origem, usuario_admin_id)
         values ($1,$2,'carteira','concluido',$3,$4,$5)`,
        [g.id, valor, motivo, opts.origem, opts.usuarioAdminId ?? null],
      );
      if (valor >= disponivel - 0.009) {
        await q.query(`update pagamentos set status = 'creditado', atualizado_em = now() where id = $1`, [g.id]);
      }
      await q.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,$4)`,
        [g.pedido_id, g.pedido_status, `R$ ${valor.toFixed(2).replace('.', ',')} viraram crédito na carteira do app`, opts.origem],
      );
      this.log.log(`PIX ${g.id} pedido #${g.numero}: ${valor} creditado na carteira (${opts.modo})`);
      return { creditado: valor };
    });
  }

  /**
   * Cliente preferiu o dinheiro: a distribuidora devolve o PIX pelo Itaú e
   * registra aqui. Tira da carteira o que foi creditado por este pedido (não
   * dá pra devolver em dinheiro um crédito que o cliente já gastou).
   */
  async registrarDevolucaoPix(
    pool: Pool,
    pagamentoId: string,
    opts: { valor: number; motivo: string; usuarioAdminId: string },
  ): Promise<{ devolvido: number }> {
    return this.emTransacao(pool, async (q) => {
      const { rows } = await q.query(
        `select g.id, g.pedido_id, g.metodo, g.status, p.numero, p.cliente_id, p.status as pedido_status,
                coalesce((select sum(e.valor) from pagamento_estornos e where e.pagamento_id = g.id
                           and e.destino = 'carteira' and e.status = 'concluido'), 0)
              - coalesce((select sum(e.valor) from pagamento_estornos e where e.pagamento_id = g.id
                           and e.destino = 'pix' and e.status = 'concluido'), 0) as creditado_restante,
                (select coalesce(sum(m.valor),0) from carteira_movimentos m where m.cliente_id = p.cliente_id) as saldo
           from pagamentos g join pedidos p on p.id = g.pedido_id where g.id = $1 for update of g`,
        [pagamentoId],
      );
      const g = rows[0];
      if (!g || g.metodo !== 'pix') throw new Error('Pagamento não é PIX');
      const restante = Number(g.creditado_restante);
      const saldo = Number(g.saldo);
      const valor = Number(opts.valor.toFixed(2));
      if (restante < 0.01) throw new Error('Este pedido não tem crédito de PIX para devolver em dinheiro');
      if (valor > restante + 0.009) throw new Error(`Dá pra devolver até R$ ${restante.toFixed(2)} (crédito deste pedido)`);
      if (valor > saldo + 0.009) {
        throw new Error(`O cliente já usou parte do crédito: saldo atual na carteira é R$ ${saldo.toFixed(2)}`);
      }
      await q.query(
        `insert into carteira_movimentos (cliente_id, valor, motivo, pedido_id, criado_por) values ($1,$2,$3,$4,$5)`,
        [g.cliente_id, -valor, `Devolvido por PIX (pedido #${g.numero})`, g.pedido_id, opts.usuarioAdminId],
      );
      await q.query(
        `insert into pagamento_estornos (pagamento_id, valor, destino, status, motivo, origem, usuario_admin_id)
         values ($1,$2,'pix','concluido',$3,'retaguarda',$4)`,
        [g.id, valor, opts.motivo, opts.usuarioAdminId],
      );
      if (valor >= restante - 0.009 && g.status === 'creditado') {
        await q.query(`update pagamentos set status = 'estornado', atualizado_em = now() where id = $1`, [g.id]);
      }
      await q.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,$2,$3,'retaguarda')`,
        [g.pedido_id, g.pedido_status, `R$ ${valor.toFixed(2).replace('.', ',')} devolvidos por PIX a pedido do cliente`],
      );
      return { devolvido: valor };
    });
  }

  /**
   * Estorno 360 (D+1): a Rede só confirma depois. Quando a consulta da
   * transação volta Canceled, fecha o estorno e o pagamento.
   */
  async confirmarEstornoSolicitado(pool: Pool, provedor: ProvedorCartao, pagamento: { id: string; provedor_ref: string }): Promise<boolean> {
    const s = await provedor.consultar(pagamento.provedor_ref);
    if (s.status !== 'cancelado') return false;
    await this.emTransacao(pool, async (q) => {
      await q.query(
        `update pagamento_estornos set status = 'concluido', atualizado_em = now() where pagamento_id = $1 and status = 'solicitado'`,
        [pagamento.id],
      );
      await q.query(
        `update pagamentos set status = 'estornado', atualizado_em = now() where id = $1 and status in ('estorno_solicitado','pago')`,
        [pagamento.id],
      );
    });
    return true;
  }
}
