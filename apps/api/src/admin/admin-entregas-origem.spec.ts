import { runComTenant } from '../tenancy/tenant-context';
import { AdminEntregasController } from './admin-entregas.controller';

const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU' };
const PRED = "origem = 'app_cliente'";

// Pedido de vendedor: toda consulta que carrega o predicado de origem volta vazia.
function montar() {
  const query = jest.fn(async (sql: string) => {
    void sql;
    return { rows: [] };
  });
  const ctl = new AdminEntregasController({} as never, { obterPorNome: jest.fn() } as never);
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT as never, pool: { query } as never }, fn);
  return { ctl, query, rodar };
}
const sqls = (q: jest.Mock) => q.mock.calls.map((c) => String((c as unknown[])[0]));
const admin = { admin: { usuarioId: 'u1', papel: 'admin' } } as never;
const ID = '11111111-1111-4111-8111-111111111111';

describe('AdminEntregasController — só pedido do Delivery', () => {
  it('registrar entrega: pedido de vendedor = não encontrado', async () => {
    const { ctl, query, rodar } = montar();
    await expect(rodar(() => ctl.registrarEntrega(ID, {} as never, {} as never))).rejects.toThrow('Pedido não encontrado');
    expect(sqls(query)[0]).toContain(PRED);
  });
  it('foto da entrega', async () => {
    const { ctl, query, rodar } = montar();
    await expect(rodar(() => ctl.fotoEntrega(ID, 'canhoto', {} as never))).rejects.toThrow();
    expect(sqls(query)[0]).toContain(PRED);
  });
  it('estorno', async () => {
    const { ctl, query, rodar } = montar();
    await expect(rodar(() => ctl.estornar(admin, ID, { motivo: 'x' } as never))).rejects.toThrow();
    expect(sqls(query)[0]).toContain(PRED);
  });
  it('cobrar e liberar reserva', async () => {
    const a = montar();
    await expect(a.rodar(() => a.ctl.cobrarReserva(admin, ID, {} as never))).rejects.toThrow();
    expect(sqls(a.query)[0]).toContain(PRED);
    const b = montar();
    await expect(b.rodar(() => b.ctl.liberarReserva(admin, ID, {} as never))).rejects.toThrow();
    expect(sqls(b.query)[0]).toContain(PRED);
  });
  it('devolução PIX', async () => {
    const { ctl, query, rodar } = montar();
    await expect(rodar(() => ctl.devolucaoPix(admin, ID, { motivo: 'x' } as never))).rejects.toThrow();
    expect(sqls(query)[0]).toContain(PRED);
  });
  it('dossiê', async () => {
    const { ctl, query, rodar } = montar();
    await expect(rodar(() => ctl.dossie(ID))).rejects.toThrow();
    expect(sqls(query)[0]).toContain("p.origem = 'app_cliente'");
  });
});
