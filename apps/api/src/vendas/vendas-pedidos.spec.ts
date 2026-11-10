// apps/api/src/vendas/vendas-pedidos.spec.ts
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { formaInterna, VendasPedidosService } from './vendas-pedidos.service';

const dto = {
  idDispositivo: '11111111-1111-4111-8111-111111111111',
  clienteId: 'c1',
  tabelaPrecoId: 't1',
  formaPagamentoId: 'f-boleto',
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
  forma?: string;
  formaExiste?: boolean;
  tabelaExiste?: boolean;
  permitida?: boolean;
  tipoTabela?: 'entrega' | 'retirada';
  semEndereco?: boolean;
  orcamento?: { clienteId: string } | null;
  formaGravada?: string;
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
    if (sql.includes('/* tabela_forma */')) {
      if (c.formaExiste === false) return { rows: [] };
      return { rows: [{ forma: c.forma ?? 'BOLETO', tabela_existe: c.tabelaExiste ?? true, permitida: c.permitida ?? true, tipo_entrega: c.tipoTabela ?? 'retirada' }] };
    }
    if (sql.includes('/* orcamento_dono */')) return { rows: c.orcamento ? [{ cliente_id: c.orcamento.clienteId }] : [] };
    if (sql.includes('from cliente_enderecos')) return { rows: c.semEndereco ? [] : [{ id: 'e1', cidade: 'Recife' }] };
    if (sql.includes('/* dados_atuais */')) {
      return { rows: [{ id: 'p1', nome: 'Margarina', preco: String(c.precoAtual ?? 86.4), estoque: String(c.estoque ?? 100) }] };
    }
    if (sql.includes('select limite_credito from clientes')) return { rows: [{ limite_credito: c.limite ?? '20000.00' }] };
    if (sql.includes('from titulos_cliente')) return { rows: [{ total: c.titulosAbertos ?? '0' }] };
    if (sql.includes('/* em_transito */')) return { rows: [{ total: c.emTransito ?? '0' }] };
    if (sql.includes('insert into pedidos')) return { rows: [{ id: 'ped-novo', numero: '8' }] };
    if (sql.includes('/* pedido_retido */')) {
      return { rows: c.retido ? [{ id: 'ped-retido', numero: '9', cliente_id: 'c1', tabela_preco_id: 't1', forma_pagamento: c.formaGravada ?? 'boleto', forma_pagamento_erp_id: 'f-boleto' }] : [] };
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
    expect(formaInterna('BOLETO')).toBe('boleto');
    expect(formaInterna('Cheque')).toBe('boleto');
    expect(formaInterna('BOLETO À VISTA')).toBe('boleto');
  });

  it('é conservadora: o que não é claramente à vista ou cartão confere crédito', () => {
    for (const d of ['CARTEIRA', 'CREDITO LOJA', 'CREDIÁRIO', 'XYZ', 'Boleto']) expect(formaInterna(d)).toBe('boleto');
    for (const d of ['CARTÃO', 'CARTAO DE CREDITO']) expect(formaInterna(d)).toBe('cartao');
    for (const d of ['DINHEIRO', 'PIX', 'À VISTA', 'DÉBITO']) expect(formaInterna(d)).toBe('pix');
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

  it('tabela de retirada sem tipoEntrega grava retirada e não exige endereço', async () => {
    const { servico, rodar, chamou, params } = montar({ tipoTabela: 'retirada', semEndereco: true });
    const { tipoEntrega: _t, ...semTipo } = dto;
    await rodar(() => servico.receber('v1', semTipo as never));
    expect(params('insert into pedidos')).toEqual(expect.arrayContaining(['retirada']));
    expect(chamou('from cliente_enderecos')).toBe(false);
  });

  it('tabela de entrega sem tipoEntrega grava entrega com o endereço do cliente', async () => {
    const { servico, rodar, params } = montar({ tipoTabela: 'entrega' });
    const { tipoEntrega: _t, ...semTipo } = dto;
    await rodar(() => servico.receber('v1', semTipo as never));
    expect(params('insert into pedidos')).toEqual(expect.arrayContaining(['entrega']));
  });

  it('tabela de entrega exige endereço do cliente', async () => {
    const { servico, rodar, chamou } = montar({ tipoTabela: 'entrega', semEndereco: true });
    await expect(rodar(() => servico.receber('v1', { ...dto, tipoEntrega: 'entrega' } as never))).rejects.toMatchObject({ response: { codigo: 'SEM_ENDERECO' } });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('tipoEntrega diferente do da tabela é recusado com TIPO_ENTREGA_DIFERENTE_DA_TABELA', async () => {
    const { servico, rodar, chamou } = montar({ tipoTabela: 'entrega' });
    const erro = await rodar(() => servico.receber('v1', { ...dto, tipoEntrega: 'retirada' } as never)).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.getResponse()).toEqual({ statusCode: 400, message: 'Esta tabela é de entrega', codigo: 'TIPO_ENTREGA_DIFERENTE_DA_TABELA' });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('sem divergência entra como RECEBIDO, marcado como do vendedor, e vai para a fila do ERP', async () => {
    const { servico, rodar, chamou, params } = montar();
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out).toEqual({ id: 'ped-novo', numero: 8, status: 'RECEBIDO', total: 345.6, divergencias: [] });
    const p = params('insert into pedidos');
    expect(p).toEqual(expect.arrayContaining(['c1', 'boleto', 'retirada', 345.6, 'RECEBIDO', 'v1', 't1', 'f-boleto', dto.idDispositivo]));
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

  it('forma fora das aceitas pela tabela é recusada com FORMA_NAO_PERMITIDA', async () => {
    const { servico, rodar, chamou } = montar({ permitida: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toMatchObject({
      response: { statusCode: 400, message: 'Forma de pagamento não permitida para esta tabela', codigo: 'FORMA_NAO_PERMITIDA' },
    });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('forma desconhecida é recusada com TABELA_OU_FORMA_INEXISTENTE', async () => {
    const { servico, rodar, chamou } = montar({ formaExiste: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toMatchObject({
      response: { statusCode: 400, message: 'Tabela ou forma de pagamento inexistente', codigo: 'TABELA_OU_FORMA_INEXISTENTE' },
    });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('tabela que não veio do ERP é recusada com TABELA_OU_FORMA_INEXISTENTE', async () => {
    const { servico, rodar, chamou } = montar({ tabelaExiste: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toMatchObject({
      response: { codigo: 'TABELA_OU_FORMA_INEXISTENTE' },
    });
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('a forma é conferida na tabela_preco_formas e o pedido grava a forma, sem condição', async () => {
    const { servico, rodar, params } = montar();
    await rodar(() => servico.receber('v1', dto as never));
    expect(params('/* tabela_forma */')).toEqual(['f-boleto', 't1']);
    const ins = params('insert into pedidos');
    expect(ins).toContain('f-boleto');
    expect(ins).not.toContain('cond1');
  });

  it('PIX numa tabela de retirada é aceito sem conferir crédito, mesmo com limite zero', async () => {
    const { servico, rodar, chamou, params } = montar({ forma: 'PIX', limite: '0' });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('RECEBIDO');
    expect(out.divergencias).toEqual([]);
    expect(chamou('select limite_credito')).toBe(false);
    expect(chamou('/* em_transito */')).toBe(false);
    expect(params('insert into pedidos')).toEqual(expect.arrayContaining(['pix']));
  });

  it('boleto com os mesmos dados e limite zero fica retido por crédito', async () => {
    const { servico, rodar, chamou } = montar({ forma: 'BOLETO', limite: '0' });
    const out = await rodar(() => servico.receber('v1', dto as never));
    expect(out.status).toBe('AGUARDANDO_VENDEDOR');
    expect(out.divergencias).toEqual([{ tipo: 'credito', enviado: 345.6, atual: 0 }]);
    expect(chamou('select limite_credito')).toBe(true);
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

describe('VendasPedidosService.receber — validação dentro da transação e orçamento', () => {
  it('a conferência de tabela e forma roda no cliente da transação, depois do bloqueio do cliente', async () => {
    const { servico, rodar, query } = montar();
    await rodar(() => servico.receber('v1', dto as never));
    const ordem = query.mock.calls.map(([sql]) => String(sql));
    const iBegin = ordem.findIndex((s) => s.trim() === 'begin');
    const iLock = ordem.findIndex((s) => s.includes('pg_advisory_xact_lock'));
    const iForma = ordem.findIndex((s) => s.includes('/* tabela_forma */'));
    expect(iBegin).toBeGreaterThanOrEqual(0);
    expect(iLock).toBeGreaterThan(iBegin);
    expect(iForma).toBeGreaterThan(iLock);
  });

  it('forma recusada dentro da transação faz rollback e não grava', async () => {
    const { servico, rodar, chamou } = montar({ permitida: false });
    await expect(rodar(() => servico.receber('v1', dto as never))).rejects.toMatchObject({ response: { codigo: 'FORMA_NAO_PERMITIDA' } });
    expect(chamou('rollback')).toBe(true);
    expect(chamou('insert into pedidos')).toBe(false);
  });

  it('orçamento do mesmo cliente converte (mesmo com tabela diferente)', async () => {
    const { servico, rodar, chamou } = montar({ orcamento: { clienteId: 'c1' } });
    await rodar(() => servico.receber('v1', { ...dto, orcamentoId: '22222222-2222-4222-8222-222222222222' } as never));
    expect(chamou("update orcamentos set status = 'convertido'")).toBe(true);
  });

  it('orçamento de outro cliente é recusado e nada é criado', async () => {
    const { servico, rodar, chamou } = montar({ orcamento: { clienteId: 'outro' } });
    const erro = await rodar(() => servico.receber('v1', { ...dto, orcamentoId: '22222222-2222-4222-8222-222222222222' } as never)).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.getResponse()).toEqual({ statusCode: 400, message: 'Orçamento não pertence a este cliente', codigo: 'ORCAMENTO_DE_OUTRO_CLIENTE' });
    expect(chamou('insert into pedidos')).toBe(false);
    expect(chamou('commit')).toBe(false);
  });

  it('orçamento que não é deste vendedor (ou não existe) também é recusado', async () => {
    const { servico, rodar, chamou, params } = montar({ orcamento: null });
    await expect(rodar(() => servico.receber('v1', { ...dto, orcamentoId: '22222222-2222-4222-8222-222222222222' } as never))).rejects.toMatchObject({ response: { codigo: 'ORCAMENTO_DE_OUTRO_CLIENTE' } });
    expect(params('/* orcamento_dono */')).toEqual(['22222222-2222-4222-8222-222222222222', 'v1']);
    expect(chamou('insert into pedidos')).toBe(false);
  });
});

describe('VendasPedidosService.confirmar', () => {
  it('regrava forma_pagamento quando o mapeamento da forma mudou', async () => {
    const { servico, rodar, params } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4, forma: 'PIX', formaGravada: 'boleto' });
    await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(params('update pedidos set forma_pagamento = $2')).toEqual(['ped-retido', 'pix']);
  });

  it('não regrava forma_pagamento quando continua igual', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4 });
    await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(chamou('update pedidos set forma_pagamento = $2')).toBe(false);
  });

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

  it('revalida a tabela e a forma guardadas no pedido', async () => {
    const { servico, rodar, params } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4 });
    await rodar(() => servico.confirmar('v1', 'ped-retido'));
    expect(params('/* tabela_forma */')).toEqual(['f-boleto', 't1']);
  });

  it('forma que a tabela deixou de aceitar não libera o pedido', async () => {
    const { servico, rodar, chamou } = montar({ retido: { precoItem: 84 }, precoAtual: 86.4, permitida: false });
    await expect(rodar(() => servico.confirmar('v1', 'ped-retido'))).rejects.toMatchObject({ response: { codigo: 'FORMA_NAO_PERMITIDA' } });
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
