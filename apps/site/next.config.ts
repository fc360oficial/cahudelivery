import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// Fotos e banners vêm do /uploads da API (outro host), por isso img-src aberto a http/https.
// O Next injeta scripts e estilos em linha; sem nonce, 'unsafe-inline' é necessário.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        // Navegador que já entrou por https não volta a tentar http por 180 dias. Só em produção:
        // o cabeçalho é ignorado em http (rede local, E2E), mas não há por que mandá-lo no dev.
        ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=15552000' }]),
      ],
    }];
  },
};

export default config;
