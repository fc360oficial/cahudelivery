import { MockProvedor } from './mock.provedor';

describe('MockProvedor', () => {
  it('cria cobrança com copia-e-cola fake e expiração pedida', async () => {
    const p = new MockProvedor();
    const antes = Date.now();
    const c = await p.criarCobranca({ ref: 'REF1', valor: 10.5, expiracaoSegundos: 60, descricao: 'x' });
    expect(c.ref).toBe('REF1');
    expect(c.copiaCola).toMatch(/^MOCKPIX-REF1-/);
    expect(c.expiraEm.getTime()).toBeGreaterThanOrEqual(antes + 60_000);
  });

  it('começa pendente e vira pago depois de simularPagamento', async () => {
    const p = new MockProvedor();
    await p.criarCobranca({ ref: 'REF2', valor: 1, expiracaoSegundos: 60, descricao: 'x' });
    expect((await p.consultar('REF2')).status).toBe('pendente');
    p.simularPagamento('REF2');
    const s = await p.consultar('REF2');
    expect(s.status).toBe('pago');
    expect(s.valorPago).toBe(1);
  });

  it('ref desconhecida consulta como cancelado', async () => {
    expect((await new MockProvedor().consultar('nada')).status).toBe('cancelado');
  });

  it('tratarWebhook aceita {ref, valor} e ignora lixo', () => {
    const p = new MockProvedor();
    expect(p.tratarWebhook(JSON.stringify({ ref: 'R', valor: 2 }))).toEqual([
      expect.objectContaining({ ref: 'R', valorPago: 2 }),
    ]);
    expect(p.tratarWebhook('não é json')).toEqual([]);
  });
});
