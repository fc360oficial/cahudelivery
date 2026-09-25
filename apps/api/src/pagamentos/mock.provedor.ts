import { CobrancaCriada, NovaCobranca, PagamentoRecebido, ProvedorPagamento, SituacaoCobranca } from './provedor-pagamento';

/**
 * Provedor de desenvolvimento: nunca chama rede. O pagamento é confirmado por
 * simularPagamento() (endpoint admin) ou por um POST no webhook com {ref, valor}.
 */
export class MockProvedor implements ProvedorPagamento {
  readonly nome = 'mock';
  readonly metodo = 'pix' as const;
  private cobrancas = new Map<string, { valor: number; pago: boolean; pagoEm?: Date }>();

  async criarCobranca(p: NovaCobranca): Promise<CobrancaCriada> {
    this.cobrancas.set(p.ref, { valor: p.valor, pago: false });
    return {
      ref: p.ref,
      copiaCola: `MOCKPIX-${p.ref}-${p.valor.toFixed(2)}`,
      expiraEm: new Date(Date.now() + p.expiracaoSegundos * 1000),
      payload: { mock: true },
    };
  }

  async consultar(ref: string): Promise<SituacaoCobranca> {
    const c = this.cobrancas.get(ref);
    if (!c) return { status: 'cancelado', payload: { mock: true, motivo: 'ref desconhecida' } };
    if (c.pago) return { status: 'pago', valorPago: c.valor, pagoEm: c.pagoEm, payload: { mock: true } };
    return { status: 'pendente', payload: { mock: true } };
  }

  simularPagamento(ref: string) {
    const c = this.cobrancas.get(ref);
    if (c) {
      c.pago = true;
      c.pagoEm = new Date();
    }
  }

  tratarWebhook(corpo: string): PagamentoRecebido[] {
    try {
      const j = JSON.parse(corpo);
      if (typeof j?.ref !== 'string') return [];
      return [{ ref: j.ref, valorPago: Number(j.valor) || 0, pagoEm: new Date() }];
    } catch {
      return [];
    }
  }
}
