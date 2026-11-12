import type { MetadataRoute } from 'next';
import { indexavel } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  if (!indexavel()) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/carrinho', '/busca'] } };
}