import type { Request } from 'express';

/** Endereço de quem abriu a conexão com a API, sem o prefixo de IPv4 mapeado em IPv6. */
export function ipDoSocket(req: Request): string {
  return (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
}

/**
 * Primeiro IP do X-Forwarded-For, mas só quando a conexão veio do próprio servidor (Caddy ou site,
 * em 127.0.0.1/::1): são eles que gravam o cabeçalho com o IP real do visitante. Quem chega direto
 * na porta da API escreve o que quiser nesse cabeçalho; se valesse, bastaria trocar o valor a cada
 * tentativa para nunca cair no bloqueio por IP. Nesse caso devolve '' e vale o endereço do socket.
 */
export function ipEncaminhado(req: Request): string {
  const socket = ipDoSocket(req);
  if (socket !== '127.0.0.1' && socket !== '::1') return '';
  return String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
}
