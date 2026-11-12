import type { MetadataRoute } from 'next';
import { indexavel } from '@/lib/site';

export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  if (!indexavel()) return { rules: { userAgent: '*', disallow: '/' } };
  return { rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/carrinho', '/busca'] } };
}