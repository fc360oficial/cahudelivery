import type { Pool } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';
import { WebhooksProcessor } from './webhooks.processor';

describe('WebhooksProcessor', () => {
  it('casa txid com pagamentos e confirma; marca o webhook processado', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-1', corpo_bruto: JSON.stringify({ ref: 'PED000001X', valor: 10 }) }] }) // pendentes
      .mockResolvedValueOnce({ rows: [{ id: 'pag-1', expira_em: new Date() }] })                                    // busca por provedor_ref
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const pagamentos = new PagamentosService();
    const confirmar = jest.spyOn(pagamentos, 'confirmarPago').mockResolvedValue(true);
    const proc = new WebhooksProcessor(pagamentos);
    await proc.processar({ query } as unknown as Pool, new MockProvedor());
    expect(query.mock.calls[1][1]).toEqual(['mock', 'PED000001X']);
    expect(confirmar).toHaveBeenCalledWith(expect.anything(), 'pag-1', 10, expect.any(Date));
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1]).toEqual(['wh-1']);
  });

  it('webhook sem ref conhecida vira erro no registro, não explode', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-2', corpo_bruto: JSON.stringify({ ref: 'NAOEXISTE', valor: 1 }) }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const proc = new WebhooksProcessor(new PagamentosService());
    await proc.processar({ query } as unknown as Pool, new MockProvedor());
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1][0]).toBe('wh-2');
    expect(marca![1][1]).toContain('NAOEXISTE');
  });
});
