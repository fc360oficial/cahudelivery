import type { Pool } from 'pg';
import { DatabaseService, ESPERA_CONEXAO_MS } from './database.service';

/**
 * Pools com espera máxima por conexão: pool esgotado tem que virar erro, não
 * travamento eterno. Nenhuma conexão é aberta aqui (o pg só conecta na 1ª consulta).
 */
describe('DatabaseService — espera máxima por conexão', () => {
  let db: DatabaseService;

  beforeEach(() => {
    db = new DatabaseService();
  });

  afterEach(async () => {
    await db.onModuleDestroy();
  });

  it('espera máxima é de 10 segundos', () => {
    expect(ESPERA_CONEXAO_MS).toBe(10_000);
  });

  it('pool de controle tem connectionTimeoutMillis', () => {
    expect((db.controlPool() as Pool & { options: { connectionTimeoutMillis?: number } }).options.connectionTimeoutMillis).toBe(10_000);
  });

  it('pool do tenant tem connectionTimeoutMillis (e o mesmo máximo de 10 conexões)', async () => {
    const controle = db.controlPool() as unknown as { query: jest.Mock };
    controle.query = jest.fn(async (sql: string) =>
      sql.includes('from tenants')
        ? { rows: [{ id: 'tnt-1', slug: 'cahu', nome_fantasia: 'CAHU', app_nome: 'CAHU Delivery', adaptador_erp: 'dlinks' }] }
        : { rows: [{ host: 'localhost', porta: 5432, banco: 'tenant_cahu', usuario: 'postgres' }] },
    );
    const pool = (await db.getTenantPool('cahu')) as Pool & { options: { connectionTimeoutMillis?: number; max?: number } };
    expect(pool.options.connectionTimeoutMillis).toBe(10_000);
    expect(pool.options.max).toBe(10);
  });
});
