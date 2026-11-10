import { NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { OrdersService } from './orders.service';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };

function montar(linhas: Record<string, unknown>[]) {
  const query = jest.fn(async () => ({ rows: linhas, rowCount: linhas.length }));
  const pool = { query } as unknown as Pool;
  const svc = new OrdersService({} as never, {} as never, {} as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool }, fn);
  return { svc, query, rodar };
}

describe('OrdersService — pedidos retidos do vendedor ficam fora do app do cliente', () => {
  it('listar exclui AGUARDANDO_VENDEDOR e cancelados ainda não confirmados', async () => {
    const { svc, query, rodar } = montar([]);
    await rodar(() => svc.listar('cli-1', 1));
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain('AGUARDANDO_VENDEDOR');
    expect(sql).toContain("retencao_json->>'confirmadoEm' is null");
  });

  it('detalhe aplica o mesmo filtro e trata pedido oculto como inexistente', async () => {
    const { svc, query, rodar } = montar([]);
    await expect(rodar(() => svc.detalhe('cli-1', 'ped-1'))).rejects.toBeInstanceOf(NotFoundException);
    const sql = String((query.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain('AGUARDANDO_VENDEDOR');
    expect(sql).toContain("retencao_json->>'confirmadoEm' is null");
  });

  it('detalhe não devolve as colunas do lado do vendedor', async () => {
    const { svc, rodar } = montar([{
      id: 'ped-1', numero: 7, total: '10.00', status: 'ENTREGUE',
      retencao_json: { x: 1 }, id_dispositivo: 'd', vendedor_id: 'v', criado_no_aparelho_em: new Date(),
    }]);
    const out = await rodar(() => svc.detalhe('cli-1', 'ped-1'));
    expect(out).toEqual({ id: 'ped-1', numero: 7, total: '10.00', status: 'ENTREGUE' });
  });
});
