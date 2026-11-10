// apps/api/src/vendas/vendas-pedidos.spec.ts
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { formaInterna, VendasPedidosService } from './vendas-pedidos.service';

const dto = {
  idDispositivo: '11111111-1111-4111-8111-111111111111',
  clienteId: 'c1',
  tabelaPrecoId: 't1',
  condicaoPagamentoId: 'cond1',
  tipoEntrega: 'retirada' as const,
  criadoNoAparelhoEm: '2026-11-09T14:00:00Z',
  itens: [{ produtoId: 'p1', quantidade: 4, precoUnit: 86.4 }],
};

interface Cenario {
  existente?: boolean;
  naCarteira?: boolean;
  precoAtual?: number;
  estoque?: number;
  retido?: { precoItem: number };
}

function montar(c: Cenario = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('where p.id_dispositivo = $1')) {
      return { rows: c.existente ? [{ id: 'ped-antigo', numero: '7', status: 'RECEBIDO', total: '345.60', retencao_json: null }] : [] };
    }
    if (sql.includes('from cliente_vendedor where cliente_id')) return { rowCount: c.naCarteira === false ? 0 : 1, rows: [] };
    if (sql.includes('from condicoes_pagamento_erp cp')) {
      return { rows: [{ condicao: 'BOLETO 14 DIAS', forma: 'BOLETO', tabela_existe: true, tabela_tem_vinculo: false, permitida: false }] };
    }
    if (sql.includes('/* dados_atuais */')) {
      return { rows: [{ id: 'p1', nome: 'Margarina', preco: String(c.precoAtual ?? 86.4), estoque: String(c.estoque ?? 100) }] };
    }
    if (sql.includes('select limite_credito from clientes')) return { rows: [{ limite_credito: '20000.00' }] };
    if (sql.includes('from titulos_cliente')) return { rows: [{ total: '0' }] };
    if (sql.includes('insert into pedidos')) return { rows: [{ id: 'ped-novo', numero: '8' }] };
    if (sql.includes('/* pedido_retido */')) {
      return { rows: c.retido ? [{ id: 'ped-retido', numero: '9', cliente_id: 'c1', tabela_preco_id: 't1', forma_pagamento: 'boleto' }] : [] };
    }
    if (sql.includes('/* itens_retidos */')) {
      return { rows: [{ produto_id: 'p1', quantidade: '4.000', preco_unit: String(c.retido?.precoItem ?? 84) }] };
    }
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release: () => undefined }) };
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: {}, pool } as never, fn);
  const chamou = (trecho: string) => query.mock.calls.some(([sql]) => String(sql).includes(trecho));
  const params = (trecho: string) => query.mock.calls.find(([sql]) => String(sql).includes(trecho))?.[1] as unknown[];
  return { servico: new VendasPedidosService(), query, rodar, chamou, params };
}

describe('formaInterna', () => {
  it('trata à vista como pix, cartão de crédito como cartao e o resto como boleto', () => {
    expect(formaInterna('PIX')).toBe('pix');
    expect(formaInterna('Dinheiro')).toBe('pix');
    expect(formaInterna('Cartão de Débito')).toBe('pix');
    expect(formaInterna('Crédito')).toBe('cartao');
    expect(formaInterna('BOLETO')).toBe('boleto');
    expect(formaInterna('Cheque')).toBe('boleto');
  });
});

describe('VendasPedidosService.receber', () => {
  it('reenvio do mesmo idDispositivo devolve o pedido existente e não grava outro', async () => {
    const { servico, rodar, chamou } = montar({ existente: true });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-antigo', numero: 7, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('recusa cliente fora da carteira do vendedor', async () => {
    const { servico, rodar, chamou } = montar({ naCarteira: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toBeInstanceOf(ForbiddenException);
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('sem divergência entra como RECEBIDO, marcado como do vendedor, e vai para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar();
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-novo', numero: 8, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    const p = params('insert into pedidos');
    expect(p).toEqual(expect.arrayContaining(['c1', 'boleto', 'retirada', 345.6, 'BOLETO 14 DIAS', 'RECEBIDO', 'v1', 't1', 'cond1', dto.idDispositivo]));
    expect(chamou('insert into sync_outbox')).toBe(true);
  });

  it('preço diferente retém o pedido com o motivo e NÃO manda para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar({ precoAtual: 90 });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('AGUARDANDO_VENDEDOR');
    expect(out.divergencias).toEqual([{ tipo: 'preco', produtoId: 'p1', nome: 'Margarina', enviado: 86.4, atual: 90 }]);
    expect(out.total).toBe(345.6);
    expect(params('insert into pedidos')).toEqual(expect.arrayContaining(['AGUARDANDO_VENDEDOR']));
    expect(chamou('insert into sync_outbox')).toBe(false);
  });
});

describe('VendasPedidosService.confirmar', () => {
  it('aceita o preço atual, libera o pedido e manda para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4 });
    const out = await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(out).toEqual({ id: 'ped-retido', numero: 9, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    expect(params('update pedido_itens set preco_unit')).toEqual(['ped-retido', 'p1', 86.4, 345.6]);
    expect(chamou('criado_em = now()')).toBe(true);
    expect(chamou('insert into sync_outbox')).toBe(true);
  });

  it('continua retido se ainda falta estoque', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 86.4 }, estoque: 1 });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toBeInstanceOf(ConflictException);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });
});
