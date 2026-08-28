import { Injectable } from '@nestjs/common';
import type { CobrancaErp, ErpAdapter, PedidoParaErp } from '@fluxo/erp-adapters';

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

/** Registry de adaptadores por tenant (instância dedicada — mocks têm estado). */
@Injectable()
export class IntegrationService {
  private adapters = new Map<string, ErpAdapter>();

  getAdapter(slug: string): ErpAdapter {
    let a = this.adapters.get(slug);
    if (!a) {
      a = new DevMockAdapter(); // Fase 4: instanciar por integracao_config.adaptador ('dlinks')
      this.adapters.set(slug, a);
    }
    return a;
  }
}
