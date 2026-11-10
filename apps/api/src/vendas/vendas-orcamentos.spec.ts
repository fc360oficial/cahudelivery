// apps/api/src/vendas/vendas-orcamentos.spec.ts
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { runComTenant } from '../tenancy/tenant-context';
import { VendasOrcamentosService } from './vendas-orcamentos.service';

const dto = {
  clienteId: 'c1',
  tabelaPrecoId: 't1',
  tipoEntrega: 'retirada' as const,
  itens: [
    { produtoId: 'p1', quantidade: 4, precoUnit: 86.4 },
    { produtoId: 'p2', quantidade: 20, precoUnit: 31 },
  ],
};

function montar(opcoes: { naCarteira?: boolean; gravou?: boolean; fkItem?: boolean; tipoTabela?: 'entrega' | 'retirada'; semTabela?: boolean; permitida?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from cliente_vendedor where cliente_id'))
      return { rowCount: opcoes.naCarteira === false ? 0 : 1, rows: [] };
    if (sql.includes('/* tabela_tipo */'))
      return { rows: opcoes.semTabela ? [] : [{ tipo_entrega: opcoes.tipoTabela ?? 'retirada' }] };
    if (sql.includes('/* tabela_forma */'))
      return { rows: [{ forma: 'BOLETO', tabela_existe: true, permitida: opcoes.permitida ?? true, tipo_entrega: 'retirada' }] };
    if (sql.includes('insert into orcamentos'))
      return { rowCount: opcoes.gravou === false ? 0 : 1, rows: [] };
    if (opcoes.fkItem && sql.includes('insert into orcamento_itens'))
      throw Object.assign(new Error('fk'), { code: '23503' });
    return { rows: [], rowCount: 0 };
  });
  const pool = {
    query,
    connect: async () => ({ query, release: () => undefined }),
  };
  const rodar = <T>(fn: () => Promise<T>) =>
    runComTenant({ tenant: {}, pool } as never, fn);
  return { servico: new VendasOrcamentosService(), query, rodar };
}

describe('VendasOrcamentosService.salvar', () => {
  it('grava o orçamento com o total calculado e troca os itens', async () => {
    const { servico, query, rodar } = montar();
    const out = await rodar(() => servico.salvar('v1', 'orc-1', dto as never));
    expect(out).toEqual({ id: 'orc-1', status: 'aberto', total: 965.6 });
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes('insert into orcamentos'),
    );
    expect(String(insert![0])).toContain(
      "where orcamentos.vendedor_id = excluded.vendedor_id and orcamentos.status = 'aberto'",
    );
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('delete from orcamento_itens'),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.filter(([sql]) =>
        String(sql).includes('insert into orcamento_itens'),
      ),
    ).toHaveLength(2);
  });

  it('grava o tipo de entrega da tabela quando o app não manda tipoEntrega', async () => {
    const { servico, query, rodar } = montar({ tipoTabela: 'entrega' });
    const { tipoEntrega: _t, ...semTipo } = dto;
    await rodar(() => servico.salvar('v1', 'orc-1', semTipo as never));
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into orcamentos'));
    expect(insert![1]).toContain('entrega');
  });

  it('tipoEntrega diferente do da tabela é recusado com TIPO_ENTREGA_DIFERENTE_DA_TABELA', async () => {
    const { servico, query, rodar } = montar({ tipoTabela: 'entrega' });
    const erro = await rodar(() => servico.salvar('v1', 'orc-1', dto as never)).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.getResponse()).toEqual({ statusCode: 400, message: 'Esta tabela é de entrega', codigo: 'TIPO_ENTREGA_DIFERENTE_DA_TABELA' });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into orcamentos'))).toBe(false);
  });

  it('forma informada é conferida na tabela e grava normalmente', async () => {
    const { servico, query, rodar } = montar();
    await rodar(() => servico.salvar('v1', 'orc-1', { ...dto, formaPagamentoId: 'f1' } as never));
    expect(query.mock.calls.find(([sql]) => String(sql).includes('/* tabela_forma */'))![1]).toEqual(['f1', 't1']);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into orcamentos'))).toBe(true);
  });

  it('forma que a tabela não aceita é recusada com FORMA_NAO_PERMITIDA e nada é gravado', async () => {
    const { servico, query, rodar } = montar({ permitida: false });
    await expect(rodar(() => servico.salvar('v1', 'orc-1', { ...dto, formaPagamentoId: 'f1' } as never))).rejects.toMatchObject({ response: { codigo: 'FORMA_NAO_PERMITIDA' } });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('insert into orcamentos'))).toBe(false);
  });

  it('orçamento sem forma continua permitido e não confere forma', async () => {
    const { servico, query, rodar } = montar();
    await rodar(() => servico.salvar('v1', 'orc-1', dto as never));
    expect(query.mock.calls.some(([sql]) => String(sql).includes('/* tabela_forma */'))).toBe(false);
  });

  it('tabela inexistente dá REFERENCIA_INVALIDA', async () => {
    const { servico, rodar } = montar({ semTabela: true });
    await expect(rodar(() => servico.salvar('v1', 'orc-1', dto as never))).rejects.toMatchObject({ response: { codigo: 'REFERENCIA_INVALIDA' } });
  });

  it('total acima do limite é recusado', async () => {
    const { servico, rodar } = montar();
    const enorme = { ...dto, itens: [{ produtoId: 'p1', quantidade: 1000, precoUnit: 2000000 }] };
    await expect(rodar(() => servico.salvar('v1', 'orc-1', enorme as never))).rejects.toMatchObject({
      response: { codigo: 'VALOR_FORA_DO_LIMITE' },
    });
  });

  it('recusa cliente fora da carteira', async () => {
    const { servico, rodar } = montar({ naCarteira: false });
    await expect(
      rodar(() => servico.salvar('v1', 'orc-1', dto as never)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa alterar orçamento já convertido, cancelado ou de outro vendedor', async () => {
    const { servico, rodar } = montar({ gravou: false });
    await expect(
      rodar(() => servico.salvar('v1', 'orc-1', dto as never)),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('responde 400 REFERENCIA_INVALIDA e faz rollback quando produto, tabela ou condição não existe mais', async () => {
    const { servico, query, rodar } = montar({ fkItem: true });
    const erro = await rodar(() => servico.salvar('v1', 'orc-1', dto as never)).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(erro.getResponse()).toMatchObject({ codigo: 'REFERENCIA_INVALIDA' });
    expect(query.mock.calls.some(([sql]) => String(sql).trim() === 'rollback')).toBe(true);
  });
});
