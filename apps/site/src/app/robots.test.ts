import { afterEach, describe, expect, it } from 'vitest';
import robots from './robots';

afterEach(() => { delete process.env.SITE_INDEXAVEL; });

describe('robots', () => {
  it('sem a flag bloqueia tudo', () => {
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });
  it('com a flag libera e protege áreas privadas', () => {
    process.env.SITE_INDEXAVEL = 'true';
    expect(robots()).toEqual({ rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/carrinho', '/busca'] } });
  });
});
