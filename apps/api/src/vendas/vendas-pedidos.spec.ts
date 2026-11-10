// apps/api/src/vendas/vendas-pedidos.spec.ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
  vendedorDoExistente?: string;
  statusCliente?: string;
  semCadastroErp?: boolean;
  limite?: string;
  titulosAbertos?: string;
  emTransito?: string;
  cancelRowCount?: number;
  precoAtual?: number;
  estoque?: number;
  retido?: { precoItem: number };
}

function montar(c: Cenario = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('where p.id_dispositivo = $1')) {
      return { rows: c.existente ? [{ id: 'ped-antigo', numero: '7', status: 'RECEBIDO', total: '345.60', retencao_json: null, vendedor_id: c.vendedorDoExistente ?? 'v1' }] : [] };
    }
    if (sql.includes('from cliente_vendedor cv join clientes c')) {
      return c.naCarteira === false ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ status: c.statusCliente ?? 'aprovado', erp_cliente_id: c.semCadastroErp ? null : '2725' }] };
    }
    if (sql.includes('with c as (')) return { rowCount: c.cancelRowCount ?? 1, rows: [] };
    if (sql.includes('from condicoes_pagamento_erp cp')) {
      return { rows: [{ condicao: 'BOLETO 14 DIAS', forma: 'BOLETO', tabela_existe: true, tabela_tem_vinculo: false, permitida: false }] };
    }
    if (sql.includes('/* dados_atuais */')) {
      return { rows: [{ id: 'p1', nome: 'Margarina', preco: String(c.precoAtual ?? 86.4), estoque: String(c.estoque ?? 100) }] };
    }
    if (sql.includes('select limite_credito from clientes')) return { rows: [{ limite_credito: c.limite ?? '20000.00' }] };
    if (sql.includes('from titulos_cliente')) return { rows: [{ total: c.titulosAbertos ?? '0' }] };
    if (sql.includes('/* em_transito */')) return { rows: [{ total: c.emTransito ?? '0' }] };
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
    expect(formaInterna('BOLETO À VISTA')).toBe('boleto');
  });
});

describe('VendasPedidosService.receber', () => {
  it('reenvio do mesmo idDispositivo devolve o pedido existente e não grava outro', async () => {
    const { servico, rodar, chamou } = montar({ existente: true });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-antigo', numero: 7, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('reenvio de idDispositivo que pertence a outro vendedor é recusado', async () => {
    const { servico, rodar, chamou } = montar({ existente: true, vendedorDoExistente: 'outro' });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toBeInstanceOf(ConflictException);
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('recusa cliente que não está cadastrado no ERP', async () => {
    const { servico, rodar, chamou } = montar({ semCadastroErp: true });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toMatchObject({ response: { codigo: 'CLIENTE_SEM_CADASTRO_ERP' } });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('recusa cliente bloqueado para novos pedidos', async () => {
    const { servico, rodar, chamou } = montar({ statusCliente: 'bloqueado' });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toBeInstanceOf(BadRequestException);
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('crédito desconta pedidos a prazo já aceitos e ainda não faturados', async () => {
    const { servico, rodar, chamou } = montar({ limite: '1000', titulosAbertos: '0', emTransito: '800' });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('AGUARDANDO_VENDEDOR');
    expect(out.divergencias).toEqual([{ tipo: 'credito', enviado: 345.6, atual: 200 }]);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });

  it('sem pedidos em trânsito o mesmo pedido cabe no limite', async () => {
    const { servico, rodar } = montar({ limite: '1000', titulosAbertos: '0', emTransito: '0' });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('RECEBIDO');
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

describe('VendasPedidosService.receber — regras de recusa', () => {
  it('só aceita tabela de preço do ERP', async () => {
    const { servico, rodar, chamou } = montar();
    await rodar(() => servico.receber('v1', dto as never));
    expect(chamou('t.id = $2 and t.erp_tabela_id is not null')).toBe(true);
  });

  it('total acima do limite é recusado antes de abrir transação', async () => {
    const { servico, rodar, chamou } = montar();
    const enorme = { ...dto, itens: [{ produtoId: 'p1', quantidade: 1000, precoUnit: 2000000 }] };
    await expect(rodar(() => servico.receber('v1', enorme as never))).rejects.toMatchObject({
      response: { codigo: 'VALOR_FORA_DO_LIMITE' },
    });
    expect(chamou('begin')).toBe(false);
  });

  it('produto repetido traz código legível', async () => {
    const { servico, rodar } = montar();
    const repetido = { ...dto, itens: [dto.itens[0], dto.itens[0]] };
    await expect(rodar(() => servico.receber('v1', repetido as never))).rejects.toMatchObject({
      response: { codigo: 'PRODUTO_REPETIDO' },
    });
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

  it('toma o mesmo bloqueio por cliente do receber', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4 });
    await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(chamou('select pg_advisory_xact_lock')).toBe(true);
  });

  it('cliente que ficou bloqueado depois da retenção não libera o pedido', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4, statusCliente: 'bloqueado' });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toBeInstanceOf(BadRequestException);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });

  it('cliente removido da carteira não libera o pedido', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 84 }, naCarteira: false });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });

  it('continua retido se ainda falta estoque', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 86.4 }, estoque: 1 });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toBeInstanceOf(ConflictException);
    expect(chamou('insert into sync_outbox')).toBe(false);
  });
});

describe('VendasPedidosService.cancelar', () => {
  it('cancela o pedido retido do vendedor', async () => {
    const { servico, rodar } = montar({ cancelRowCount: 1 });
    expect(await rodar(() => servico.cancelar('v1', 'ped-retido'))).toEqual({ ok: true });
  });

  it('reabre o orçamento que tinha virado este pedido', async () => {
    const { servico, rodar, chamou, params } = montar({ cancelRowCount: 1 });
    await rodar(() => servico.cancelar('v1', 'ped-retido'));
    expect(chamou("update orcamentos set status = 'aberto', pedido_id = null")).toBe(true);
    expect(params("update orcamentos set status = 'aberto'")).toEqual(['ped-retido', 'v1']);
  });

  it('não mexe em orçamento quando o cancelamento não achou o pedido', async () => {
    const { servico, rodar, chamou } = montar({ cancelRowCount: 0 });
    await expect(rodar(() => servico.cancelar('v1', 'ped-retido'))).rejects.toBeInstanceOf(NotFoundException);
    expect(chamou('update orcamentos')).toBe(false);
  });

  it('pedido inexistente ou já resolvido dá 404', async () => {
    const { servico, rodar } = montar({ cancelRowCount: 0 });
    await expect(rodar(() => servico.cancelar('v1', 'ped-retido'))).rejects.toBeInstanceOf(NotFoundException);
  });
});
