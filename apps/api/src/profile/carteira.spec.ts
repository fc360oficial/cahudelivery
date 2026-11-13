import { runComTenant } from '../tenancy/tenant-context';
import { ProfileController } from './profile.controller';

const TENANT = { id: 't', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU', adaptadorErp: 'dlinks' };
const req = { cliente: { clienteId: 'cli-1' } } as never;

/** Banco falso: 60 movimentos de R$ 1,00 (só 50 cabem na lista) e o saldo de todos somado no banco. */
function montar(saldoTotal: string) {
  const movimentos = Array.from({ length: 50 }, (_, i) => ({ id: `m${i}`, valor: '1.00', motivo: 'x', criado_em: new Date() }));
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('sum(valor)')) return { rows: [{ saldo: saldoTotal }] };
    return { rows: movimentos };
  });
  const rodar = <T>(fn: () => Promise<T>) => runComTenant({ tenant: TENANT, pool: { query } } as never, fn);
  return { query, rodar, movimentos };
}

describe('GET /v1/carteira', () => {
  it('saldo soma TODOS os movimentos do cliente; a lista continua nos 50 mais recentes', async () => {
    const { query, rodar, movimentos } = montar('60.00');
    const out = await rodar(() => new ProfileController().carteira(req));
    expect(out).toEqual({ saldo: 60, movimentos });
    const sqls = query.mock.calls.map((c) => [String((c as unknown[])[0]), (c as unknown[])[1]]);
    const soma = sqls.find(([s]) => (s as string).includes('sum(valor)'))!;
    expect(soma[0]).toContain('from carteira_movimentos where cliente_id = $1');
    expect(soma[0]).not.toContain('limit');
    expect(soma[1]).toEqual(['cli-1']);
    const lista = sqls.find(([s]) => !(s as string).includes('sum(valor)'))!;
    expect(lista[0]).toContain('order by criado_em desc limit 50');
    expect(lista[1]).toEqual(['cli-1']);
  });

  it('formato inalterado: saldo número (numeric chega como string), negativo e zero inclusive', async () => {
    for (const [banco, esperado] of [['1234.56', 1234.56], ['-3.10', -3.1], ['0', 0]] as const) {
      const { rodar } = montar(banco);
      const out = await rodar(() => new ProfileController().carteira(req));
      expect(out.saldo).toBe(esperado);
      expect(typeof out.saldo).toBe('number');
      expect(Object.keys(out)).toEqual(['saldo', 'movimentos']);
    }
  });
});
