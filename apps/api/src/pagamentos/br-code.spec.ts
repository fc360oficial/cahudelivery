import { crc16, montarBrCode } from './br-code';

describe('br-code', () => {
  it('calcula o CRC16-CCITT-FALSE (vetor padrão "123456789" => 29B1)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('monta um BR Code dinâmico a partir do location', () => {
    const codigo = montarBrCode({
      location: 'qrcodepix.itau.com.br/abc123',
      nomeRecebedor: 'CAHU DISTRIBUIDORA',
      cidade: 'RECIFE',
      txid: 'PED0000123ABCDEFGHIJKLMNOPQR',
    });
    expect(codigo.startsWith('000201')).toBe(true);
    expect(codigo).toContain('0014br.gov.bcb.pix');
    expect(codigo).toContain('2528qrcodepix.itau.com.br/abc123');
    expect(codigo).toContain('5918CAHU DISTRIBUIDORA');
    expect(codigo).toContain('6006RECIFE');
    expect(codigo).toContain('62320528PED0000123ABCDEFGHIJKLMNOPQR');
    expect(codigo).toMatch(/6304[0-9A-F]{4}$/);
    expect(codigo.slice(-4)).toBe(crc16(codigo.slice(0, -4)));
  });

  it('corta nome e cidade nos limites do padrão (25 e 15)', () => {
    const codigo = montarBrCode({ location: 'x', nomeRecebedor: 'A'.repeat(40), cidade: 'B'.repeat(30), txid: 'T1' });
    expect(codigo).toContain('5925' + 'A'.repeat(25));
    expect(codigo).toContain('6015' + 'B'.repeat(15));
  });

  it('remove acentos do nome e da cidade', () => {
    const codigo = montarBrCode({ location: 'x', nomeRecebedor: 'DISTRIBUIÇÃO JOÃO', cidade: 'SÃO PAULO', txid: 'T1' });
    expect(codigo).toContain('5917DISTRIBUICAO JOAO');
    expect(codigo).toContain('6009SAO PAULO');
  });
});
