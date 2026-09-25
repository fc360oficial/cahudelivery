import type { Pool } from 'pg';
import { MockProvedor } from './mock.provedor';
import { PagamentosService } from './pagamentos.service';
import { WebhooksProcessor } from './webhooks.processor';

describe('WebhooksProcessor', () => {
  it('casa txid com pagamentos, consulta o provedor (fonte da verdade) e aplica a situação; marca o webhook processado', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-1', corpo_bruto: JSON.stringify({ ref: 'PED000001X', valor: 10 }) }] }) // pendentes (só do provedor)
      .mockResolvedValueOnce({ rows: [{ id: 'pag-1', expira_em: new Date(), status: 'pendente' }] })                    // busca por provedor_ref
      .mockResolvedValueOnce({ rows: [{ status: 'pago' }] })                                                            // re-select status após aplicarSituacao
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const pagamentos = new PagamentosService();
    const aplicarSituacao = jest.spyOn(pagamentos, 'aplicarSituacao').mockResolvedValue();
    const provedor = new MockProvedor();
    const consultar = jest.spyOn(provedor, 'consultar').mockResolvedValue({ status: 'pago', valorPago: 10, pagoEm: new Date(), payload: {} });
    const proc = new WebhooksProcessor(pagamentos);
    await proc.processar({ query } as unknown as Pool, provedor);
    // A1: filtra por origem = provedor.nome
    expect(query.mock.calls[0][1]).toEqual(['mock']);
    expect(query.mock.calls[1][1]).toEqual(['mock', 'PED000001X']);
    expect(consultar).toHaveBeenCalledWith('PED000001X');
    expect(aplicarSituacao).toHaveBeenCalledWith(expect.anything(), { id: 'pag-1', expira_em: expect.any(Date), status: 'pendente' }, expect.objectContaining({ status: 'pago' }));
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1]).toEqual(['wh-1', null]);
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

  it('consultar/aplicarSituacao do primeiro webhook lança; o segundo segue processado normalmente', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [
          { id: 'wh-1', corpo_bruto: JSON.stringify({ ref: 'REF1', valor: 5 }) },
          { id: 'wh-2', corpo_bruto: JSON.stringify({ ref: 'REF2', valor: 7 }) },
        ] })                                                                              // pendentes
      .mockResolvedValueOnce({ rows: [{ id: 'pag-1', expira_em: new Date(), status: 'pendente' }] }) // busca por provedor_ref (wh-1)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })                                   // set processado = true (wh-1)
      .mockResolvedValueOnce({ rows: [{ id: 'pag-2', expira_em: new Date(), status: 'pendente' }] }) // busca por provedor_ref (wh-2)
      .mockResolvedValueOnce({ rows: [{ status: 'pago' }] })                              // re-select status (wh-2)
      .mockResolvedValue({ rows: [], rowCount: 0 });                                      // set processado = true (wh-2)
    const pagamentos = new PagamentosService();
    jest.spyOn(pagamentos, 'aplicarSituacao').mockResolvedValue();
    const provedor = new MockProvedor();
    const consultar = jest.spyOn(provedor, 'consultar')
      .mockRejectedValueOnce(new Error('falha ao consultar pag-1'))
      .mockResolvedValueOnce({ status: 'pago', valorPago: 7, pagoEm: new Date(), payload: {} });
    const proc = new WebhooksProcessor(pagamentos);
    await proc.processar({ query } as unknown as Pool, provedor);
    expect(consultar).toHaveBeenCalledWith('REF2');
    const marcas = query.mock.calls.filter((c) => (c[0] as string).includes('set processado = true'));
    expect(marcas).toHaveLength(2);
    expect(marcas[0][1][0]).toBe('wh-1');
    expect(marcas[0][1][1]).toContain('falha ao consultar pag-1');
    expect(marcas[1][1]).toEqual(['wh-2', null]);
  });

  it('webhook confirma pagamento mas pagamento já está expirado: registra "provedor confirmou mas pagamento ficou expirado"', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ rows: [{ id: 'wh-3', corpo_bruto: JSON.stringify({ ref: 'REF3', valor: 9 }) }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pag-3', expira_em: new Date(Date.now() - 60_000), status: 'expirado' }] })
      .mockResolvedValueOnce({ rows: [{ status: 'expirado' }] }) // re-select: aplicarSituacao não reabre expirado
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const pagamentos = new PagamentosService();
    jest.spyOn(pagamentos, 'aplicarSituacao').mockResolvedValue();
    const provedor = new MockProvedor();
    jest.spyOn(provedor, 'consultar').mockResolvedValue({ status: 'pago', valorPago: 9, pagoEm: new Date(), payload: {} });
    const proc = new WebhooksProcessor(pagamentos);
    await proc.processar({ query } as unknown as Pool, provedor);
    const marca = query.mock.calls.find((c) => (c[0] as string).includes('set processado = true'));
    expect(marca![1][1]).toContain('ref REF3: provedor confirmou mas pagamento ficou expirado');
  });
});
