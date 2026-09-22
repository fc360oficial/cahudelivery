import { Logger } from '@nestjs/common';
import { DlinksSyncService } from './dlinks-sync.service';
import { runComTenant } from '../tenancy/tenant-context';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

const clienteBase = {
  codigo: '00123',
  razao_social: 'Mercado Exemplo LTDA',
  cnpj_cpf: '12.345.678/0001-90',
  endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Petrolina', uf: 'PE', cep: '56302000' },
};

function montar() {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('insert into clientes')) return { rows: [{ id: 'c1', inserido: false }] };
    return { rows: [{ '?column?': 1 }] }; // credencial já existe
  });
  const servico = new DlinksSyncService();
  return { servico, query, pool: { query } };
}

async function sincronizar(servico: DlinksSyncService, pool: unknown, itens: unknown[]) {
  // TenantContext é { tenant, pool }; o `tenant` não é lido por syncClientes.
  await runComTenant({ tenant: {}, pool } as never, () => servico.syncClientes(itens as never));
}

describe('syncClientes e a inscricao estadual', () => {
  it('usa coalesce para nao apagar a IE que o cliente digitou no app', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [clienteBase]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(String(insert![0])).toContain('inscricao_estadual = coalesce(excluded.inscricao_estadual, clientes.inscricao_estadual)');
  });

  it('manda null quando o Dlinks nao envia o campo', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [clienteBase]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(insert![1]).toContain(null);
  });

  it('grava a IE quando o Dlinks envia', async () => {
    const { servico, query, pool } = montar();
    await sincronizar(servico, pool, [{ ...clienteBase, inscricao_estadual: '0612345-6' }]);
    const insert = query.mock.calls.find(([sql]) => String(sql).includes('insert into clientes'));
    expect(insert![1]).toContain('06123456');
  });
});
