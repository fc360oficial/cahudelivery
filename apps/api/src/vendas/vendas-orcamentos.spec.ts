// apps/api/src/vendas/vendas-orcamentos.spec.ts
import { ConflictException, ForbiddenException } from '@nestjs/common';
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

function montar(opcoes: { naCarteira?: boolean; gravou?: boolean } = {}) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('from cliente_vendedor where cliente_id'))
      return { rowCount: opcoes.naCarteira === false ? 0 : 1, rows: [] };
    if (sql.includes('insert into orcamentos'))
      return { rowCount: opcoes.gravou === false ? 0 : 1, rows: [] };
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
});
