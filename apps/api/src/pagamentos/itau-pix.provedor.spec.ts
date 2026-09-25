import { ItauPixProvedor, traduzirStatusItau } from './itau-pix.provedor';

const cfg = {
  chavePix: '61920643000148', nomeRecebedor: 'CAHU DISTRIBUIDORA', cidade: 'RECIFE',
  clientId: 'cid', clientSecret: 'sec', pfx: Buffer.from(''), pfxSenha: 'x',
};

describe('ItauPixProvedor', () => {
  it('tratarWebhook extrai txid/valor/horario de cada pix', () => {
    const p = new ItauPixProvedor(cfg);
    const corpo = JSON.stringify({
      pix: [
        { endToEndId: 'E1', txid: 'PED000001AAAA', valor: '99.90', horario: '2026-09-25T14:32:00.000Z' },
        { endToEndId: 'E2', txid: 'PED000002BBBB', valor: '1.00', horario: '2026-09-25T15:00:00.000Z' },
      ],
    });
    const r = p.tratarWebhook(corpo);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ ref: 'PED000001AAAA', valorPago: 99.9, pagoEm: new Date('2026-09-25T14:32:00.000Z') });
  });

  it('tratarWebhook ignora corpo sem pix ou inválido', () => {
    const p = new ItauPixProvedor(cfg);
    expect(p.tratarWebhook('{}')).toEqual([]);
    expect(p.tratarWebhook('<xml/>')).toEqual([]);
    expect(p.tratarWebhook(JSON.stringify({ pix: [{ endToEndId: 'E' }] }))).toEqual([]);
  });

  it('traduz os status do Itaú', () => {
    expect(traduzirStatusItau({ status: 'ATIVA' }).status).toBe('pendente');
    expect(traduzirStatusItau({ status: 'REMOVIDA_PELO_PSP' }).status).toBe('expirado');
    expect(traduzirStatusItau({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' }).status).toBe('cancelado');
    const pago = traduzirStatusItau({ status: 'CONCLUIDA', pix: [{ valor: '12.34', horario: '2026-09-25T10:00:00Z' }] });
    expect(pago.status).toBe('pago');
    expect(pago.valorPago).toBe(12.34);
    expect(pago.pagoEm).toEqual(new Date('2026-09-25T10:00:00Z'));
  });

  it('copiaColaDaResposta usa pixCopiaECola se vier, senão monta do location', () => {
    const p = new ItauPixProvedor(cfg);
    expect(p.copiaColaDaResposta({ pixCopiaECola: '000201...' }, 'T')).toBe('000201...');
    const montado = p.copiaColaDaResposta({ location: 'qrcodepix.itau.com.br/x' }, 'PED000001AAAAAAAAAAAAAAAAAAAAA');
    expect(montado).toContain('br.gov.bcb.pix');
    expect(montado).toContain('qrcodepix.itau.com.br/x');
  });
});
