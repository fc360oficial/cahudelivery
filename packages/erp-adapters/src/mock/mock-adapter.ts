/**
 * Adaptador MOCK — usado em desenvolvimento e testes enquanto o transporte
 * real do ERP do tenant (ex.: Dlinks) não está homologado.
 * Simula um ERP que fatura o pedido segundos após recebê-lo.
 */
import type {
  ClienteErp,
  CobrancaErp,
  ErpAdapter,
  ErpCapacidades,
  EstoqueErp,
  NotaFiscalErp,
  PedidoParaErp,
  PrecoErp,
  ProdutoErp,
  ResultadoTeste,
  StatusPedidoErp,
} from '../contrato';

interface PedidoMock {
  pedido: PedidoParaErp;
  recebidoEm: Date;
}

export class MockErpAdapter implements ErpAdapter {
  readonly nome = 'mock';
  readonly capacidades: ErpCapacidades = {
    suportaWebhook: false,
    suportaPrecoPorCliente: true,
    suportaPix: true,
    suportaBoleto: true,
    suportaSyncIncremental: true,
    suportaPull: false,
  };

  private pedidos = new Map<string, PedidoMock>();

  async syncProdutos(): Promise<ProdutoErp[]> {
    return Array.from({ length: 30 }, (_, i) => ({
      erpProdutoId: `MOCK-${i + 1}`,
      sku: `SKU-${String(i + 1).padStart(4, '0')}`,
      nome: `Produto Demonstração ${i + 1}`,
      descricao: 'Produto gerado pelo adaptador mock para desenvolvimento.',
      unidadeVenda: i % 3 === 0 ? 'CX' : 'UN',
      qtdPorEmbalagem: i % 3 === 0 ? 12 : 1,
      ativo: true,
      atualizadoEm: new Date(),
    }));
  }

  async syncPrecos(): Promise<PrecoErp[]> {
    return (await this.syncProdutos()).map((p, i) => ({
      erpProdutoId: p.erpProdutoId,
      preco: Number((9.9 + i * 3.5).toFixed(2)),
    }));
  }

  async syncEstoque(): Promise<EstoqueErp[]> {
    return (await this.syncProdutos()).map((p, i) => ({
      erpProdutoId: p.erpProdutoId,
      quantidade: (i * 7) % 120,
    }));
  }

  async syncClientes(): Promise<ClienteErp[]> {
    return [
      {
        erpClienteId: 'CLI-1',
        documento: '00000000000191',
        nomeFantasia: 'Mercadinho Demonstração',
        bloqueado: false,
      },
    ];
  }

  async enviarPedido(pedido: PedidoParaErp): Promise<{ erpPedidoId: string }> {
    // Idempotência: mesmo fluxoPedidoId → mesmo erpPedidoId
    const erpPedidoId = `ERP-${pedido.fluxoPedidoId.slice(0, 8).toUpperCase()}`;
    if (!this.pedidos.has(erpPedidoId)) {
      this.pedidos.set(erpPedidoId, { pedido, recebidoEm: new Date() });
    }
    return { erpPedidoId };
  }

  async consultarStatusPedido(erpPedidoId: string): Promise<StatusPedidoErp> {
    const reg = this.pedidos.get(erpPedidoId);
    if (!reg) return { erpPedidoId, status: 'ENVIADO_ERP', detalhe: 'não encontrado no mock' };
    const segundos = (Date.now() - reg.recebidoEm.getTime()) / 1000;
    const status =
      segundos > 120 ? 'SAIU_ENTREGA' : segundos > 60 ? 'EM_SEPARACAO' : segundos > 15 ? 'FATURADO' : 'ENVIADO_ERP';
    return { erpPedidoId, status };
  }

  async obterNotaFiscal(erpPedidoId: string): Promise<NotaFiscalErp | null> {
    const st = await this.consultarStatusPedido(erpPedidoId);
    if (st.status === 'ENVIADO_ERP') return null;
    return { numeroNf: `NF-${erpPedidoId}`, emitidaEm: new Date() };
  }

  async obterCobranca(erpPedidoId: string): Promise<CobrancaErp | null> {
    const reg = this.pedidos.get(erpPedidoId);
    const st = await this.consultarStatusPedido(erpPedidoId);
    if (!reg || st.status === 'ENVIADO_ERP') return null;
    const itensTotal = reg.pedido.itens.reduce((s, i) => s + i.quantidade * i.precoUnit, 0);
    const valor = Math.max(0, itensTotal - (reg.pedido.valorAbatidoSaldo ?? 0));
    return reg.pedido.formaPagamento === 'pix'
      ? { tipo: 'pix', pixCopiaCola: `00020126MOCK${erpPedidoId}`, valor: Number(valor.toFixed(2)) }
      : { tipo: 'boleto', linhaDigitavel: `23790.MOCK ${erpPedidoId}`, valor: Number(valor.toFixed(2)) };
  }

  async testarConexao(): Promise<ResultadoTeste> {
    return { ok: true, mensagem: 'Adaptador mock operacional', latenciaMs: 1 };
  }
}
