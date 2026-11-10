import { paginaDe } from './admin-vendas-util';

describe('paginaDe', () => {
  it('valores normais', () => {
    expect(paginaDe('3')).toBe(3);
    expect(paginaDe(undefined)).toBe(1);
    expect(paginaDe('-4')).toBe(1);
    expect(paginaDe('abc')).toBe(1);
  });
  it('limita a 100000, sem notação exponencial no offset', () => {
    for (const v of ['1e23', '100000000000000000000000', '99999999999']) {
      const p = paginaDe(v);
      expect(p).toBeLessThanOrEqual(100000);
      expect(String((p - 1) * 30)).not.toMatch(/e/i);
    }
    expect(paginaDe('100000')).toBe(100000);
  });
});
