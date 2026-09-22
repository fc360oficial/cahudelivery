import { createHmac, timingSafeEqual } from 'node:crypto';

export type TipoArquivo = 'xml' | 'pdf';

/** Nome do arquivo em cada URL — também é o que o navegador usa ao salvar. */
const ARQUIVO: Record<TipoArquivo, string> = { xml: 'nota.xml', pdf: 'danfe.pdf' };

/**
 * Assina o par (tenant, pedido, tipo). O app abre o PDF no navegador externo
 * (`launchUrl`), que não manda o JWT nem o header X-Tenant — então a própria
 * URL precisa ser a credencial. O slug entra no HMAC para que uma assinatura
 * válida num tenant não valha noutro.
 */
export function assinarNota(slug: string, pedidoId: string, tipo: TipoArquivo): string {
  const segredo = process.env.JWT_SECRET ?? 'dev-secret-trocar-em-producao';
  // Normaliza pra minúsculas: quem grava a URL (o service, com tenant.slug
  // cru) e quem confere (o controller, que já faz toLowerCase()) precisam
  // bater sempre, mesmo se o slug estiver salvo com maiúscula no banco.
  return createHmac('sha256', segredo).update(`${slug.toLowerCase()}:${pedidoId}:${tipo}`).digest('hex').slice(0, 32);
}

export function assinaturaConfere(
  slug: string,
  pedidoId: string,
  tipo: TipoArquivo,
  recebida: string | undefined,
): boolean {
  if (!recebida) return false;
  const esperada = assinarNota(slug, pedidoId, tipo);
  // timingSafeEqual exige buffers do mesmo tamanho — comparar antes evita a exceção.
  if (recebida.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(recebida), Buffer.from(esperada));
}

/**
 * URL absoluta e estável, gravada em pedido_notas no momento do faturamento.
 * Sem PUBLIC_URL devolve null — melhor a nota ficar sem link do que com um
 * link quebrado que o cliente clica e não abre.
 */
export function urlNota(slug: string, pedidoId: string, tipo: TipoArquivo): string | null {
  const base = process.env.PUBLIC_URL?.replace(/\/+$/, '');
  if (!base) return null;
  const slugNormalizado = slug.toLowerCase();
  return `${base}/v1/notas/${slugNormalizado}/${pedidoId}/${ARQUIVO[tipo]}?t=${assinarNota(slugNormalizado, pedidoId, tipo)}`;
}
