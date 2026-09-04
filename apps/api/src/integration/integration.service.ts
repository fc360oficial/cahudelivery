import { Injectable } from '@nestjs/common';
import type { CobrancaErp, ErpAdapter, NotaFiscalErp, PedidoParaErp, StatusPedidoErp } from '@fluxo/erp-adapters';
import { DatabaseService } from '../database/database.service';

/**
 * Mock de desenvolvimento (runtime local da API).
 * O contrato canônico vive em packages/erp-adapters; este mock compacto
 * simula um ERP que fatura ~15s após receber o pedido.
 * O adaptador real do Dlinks entrará aqui na Fase 4 (leitura no banco do
 * ERP para sync; entrada de pedidos pelo mecanismo que o Dlinks oferecer).
 */
class DevMockAdapter implements ErpAdapter {
  readonly nome = 'mock';
  readonly capacidades = {
    suportaWebhook: false,
    suportaPrecoPorCliente: true,
    suportaPix: true,
    suportaBoleto: true,
    suportaSyncIncremental: true,
    suportaPull: false,
  };
  private pedidos = new Map<string, { pedido: PedidoParaErp; em: number }>();

  async syncProdutos() {
    return [];
  }
  async syncPrecos() {
    return [];
  }
  async syncEstoque() {
    return [];
  }
  async syncClientes() {
    return [];
  }

  async enviarPedido(pedido: PedidoParaErp) {
    const erpPedidoId = `ERP-${pedido.fluxoPedidoId.slice(0, 8).toUpperCase()}`;
    if (!this.pedidos.has(erpPedidoId)) this.pedidos.set(erpPedidoId, { pedido, em: Date.now() });
    return { erpPedidoId };
  }

  async consultarStatusPedido(erpPedidoId: string) {
    const reg = this.pedidos.get(erpPedidoId);
    const s = reg ? (Date.now() - reg.em) / 1000 : 0;
    const status = s > 120 ? ('SAIU_ENTREGA' as const) : s > 60 ? ('EM_SEPARACAO' as const) : s > 15 ? ('FATURADO' as const) : ('ENVIADO_ERP' as const);
    return { erpPedidoId, status };
  }

  async obterNotaFiscal(erpPedidoId: string) {
    const { status } = await this.consultarStatusPedido(erpPedidoId);
    return status === 'ENVIADO_ERP' ? null : { numeroNf: `NF-${erpPedidoId}`, emitidaEm: new Date() };
  }

  async obterCobranca(erpPedidoId: string): Promise<CobrancaErp | null> {
    const reg = this.pedidos.get(erpPedidoId);
    const { status } = await this.consultarStatusPedido(erpPedidoId);
    if (!reg || status === 'ENVIADO_ERP') return null;
    const itensTotal = reg.pedido.itens.reduce((t, i) => t + i.quantidade * i.precoUnit, 0);
    const valor = Math.max(0, itensTotal - (reg.pedido.valorAbatidoSaldo ?? 0));
    return reg.pedido.formaPagamento === 'pix'
      ? { tipo: 'pix', pixCopiaCola: `00020126MOCK${erpPedidoId}`, valor: Number(valor.toFixed(2)) }
      : { tipo: 'boleto', linhaDigitavel: `23790.MOCK ${erpPedidoId}`, valor: Number(valor.toFixed(2)) };
  }

  async testarConexao() {
    return { ok: true, mensagem: 'mock ok' };
  }
}

/**
 * Adaptador real do Dlinks (Fase 4a-4e): modelo pull, não push. O núcleo só
 * precisa saber que este ERP não é chamado de fora — todo o trabalho real
 * acontece nos controllers de `integracoes-dlinks` (GET /pedidos, POST
 * /recebido, /cancelado, /pedidos-faturados, e o sync de catálogo/clientes).
 * `suportaPull: true` faz o OutboxWorker.processarOutbox nunca chamar
 * enviarPedido (o pedido fica em RECEBIDO até o Dlinks confirmar) e faz
 * sincronizarStatus nunca pegar esses pedidos (erp_pedido_id nunca é
 * setado por este adaptador) — sem isso os dois caminhos (polling do mock
 * e push real do Dlinks) brigavam pelo mesmo pedido.
 */
class DlinksPullAdapter implements ErpAdapter {
  readonly nome = 'dlinks';
  readonly capacidades = {
    suportaWebhook: false,
    suportaPrecoPorCliente: true,
    suportaPix: true,
    suportaBoleto: true,
    suportaSyncIncremental: true,
    suportaPull: true,
  };

  async syncProdutos() {
    return [];
  }
  async syncPrecos() {
    return [];
  }
  async syncEstoque() {
    return [];
  }
  async syncClientes() {
    return [];
  }
  async enviarPedido(): Promise<{ erpPedidoId: string }> {
    throw new Error('DlinksPullAdapter não envia pedido — o Dlinks consulta via GET /pedidos');
  }
  async consultarStatusPedido(): Promise<StatusPedidoErp> {
    throw new Error('DlinksPullAdapter não é consultado — status chega via POST /pedidos-faturados');
  }
  async obterNotaFiscal(): Promise<NotaFiscalErp | null> {
    throw new Error('DlinksPullAdapter não recebe NF do Dlinks ainda — endpoint pendente de confirmação (ver pergunta 7 do handoff Dlinks)');
  }
  async obterCobranca(): Promise<CobrancaErp | null> {
    throw new Error('DlinksPullAdapter não recebe cobrança do Dlinks ainda — endpoint pendente de confirmação (ver pergunta 7 do handoff Dlinks)');
  }
  async testarConexao() {
    return { ok: true, mensagem: 'dlinks (pull) ok' };
  }
}

/** Registry de adaptadores por tenant (instância dedicada — mocks têm estado). */
@Injectable()
export class IntegrationService {
  private adapters = new Map<string, ErpAdapter>();

  constructor(private readonly db: DatabaseService) {}

  async getAdapter(slug: string): Promise<ErpAdapter> {
    let a = this.adapters.get(slug);
    if (!a) {
      const tenant = await this.db.getTenant(slug);
      a = tenant.adaptadorErp === 'dlinks' ? new DlinksPullAdapter() : new DevMockAdapter();
      this.adapters.set(slug, a);
    }
    return a;
  }
}
