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

describe('OrdersService — o app do cliente só enxerga pedidos de origem app_cliente', () => {
  const sqlDa = (query: jest.Mock, i = 0) => String((query.mock.calls[i] as unknown[])[0]);
  it('listar, detalhe (pedido do vendedor = não encontrado), notas e repetir filtram a origem', async () => {
    const l = montar([]);
    await l.rodar(() => l.svc.listar('cli-1', 1));
    expect(sqlDa(l.query)).toContain("p.origem in ('app_cliente','site')");
    const d = montar([]);
    await expect(d.rodar(() => d.svc.detalhe('cli-1', 'ped-v'))).rejects.toBeInstanceOf(NotFoundException);
    expect(sqlDa(d.query)).toContain("p.origem in ('app_cliente','site')");
    const n = montar([]);
    await n.rodar(() => n.svc.notas('cli-1', 1));
    expect(sqlDa(n.query)).toContain("p.origem in ('app_cliente','site')");
    const r = montar([{ id: 'carr-1' }]);
    (r.svc as unknown as { catalog: unknown }).catalog = { tabelaPrecoDe: async () => null };
    await r.rodar(() => r.svc.repetir('cli-1', 'ped-1'));
    const ins = r.query.mock.calls.map((c) => String((c as unknown[])[0])).find((s) => s.includes('insert into carrinho_itens'));
    expect(ins).toContain("p.origem in ('app_cliente','site')");
  });

  it('validarRiscoCartao conta só pedidos anteriores do app do cliente', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('cartao_valor_maximo')) {
        return { rows: [{ chave: 'cartao_pedidos_anteriores', valor_json: { valor: 2 } }] };
      }
      return { rows: [{ n: 5 }] };
    });
    const svc = new OrdersService({} as never, {} as never, {} as never);
    await runComTenant({ tenant: TENANT as never, pool: { query } as never }, () =>
      (svc as unknown as { validarRiscoCartao(c: string, s: number): Promise<void> }).validarRiscoCartao('cli-1', 10));
    const contagem = query.mock.calls.map((c) => String((c as unknown[])[0])).find((s) => s.includes('count(*)'));
    expect(contagem).toContain("origem in ('app_cliente','site')");
  });
});
