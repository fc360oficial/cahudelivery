import { UUID_INTEIRO } from '@/lib/formato/caminhos';

export type ArquivoNota = 'danfe' | 'xml';

const NOME_NA_API: Record<ArquivoNota, string> = { danfe: 'danfe.pdf', xml: 'nota.xml' };

/**
 * A API grava em pedido_notas uma URL absoluta e assinada (HMAC na query `t`), montada com o
 * PUBLIC_URL dela. O site nunca entrega essa URL ao navegador: tira dela só tenant, pedido e
 * assinatura, confere tudo e devolve o caminho relativo a `/v1` para buscar pelo API_URL do
 * próprio servidor. O host da URL gravada é ignorado (nada de buscar em host vindo de dado).
 */
export function caminhoArquivoNota(url: unknown, pedidoId: string, arquivo: ArquivoNota, tenant: string): string | null {
  if (typeof url !== 'string' || url.length > 2000 || !UUID_INTEIRO.test(pedidoId)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = /\/notas\/([a-z0-9-]{1,64})\/([0-9a-f-]{36})\/(danfe\.pdf|nota\.xml)$/i.exec(u.pathname);
  if (!m) return null;
  const [, slug, id, nome] = m;
  const t = u.searchParams.get('t');
  if (slug.toLowerCase() !== tenant.toLowerCase()) return null;
  if (id.toLowerCase() !== pedidoId.toLowerCase()) return null;
  if (nome.toLowerCase() !== NOME_NA_API[arquivo]) return null;
  if (!t || !/^[0-9a-f]{32}$/.test(t)) return null;
  return `/notas/${slug.toLowerCase()}/${id.toLowerCase()}/${NOME_NA_API[arquivo]}?t=${t}`;
}

/** Nome do arquivo para o Content-Disposition, só com caracteres seguros. */
export function nomeArquivoNota(arquivo: ArquivoNota, nota: { numero: string; chaveAcesso: string | null }): string {
  const limpo = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').slice(0, 60);
  if (arquivo === 'danfe') {
    const n = limpo(nota.numero);
    return n ? `DANFE-${n}.pdf` : 'DANFE.pdf';
  }
  const chave = nota.chaveAcesso && /^\d{44}$/.test(nota.chaveAcesso) ? nota.chaveAcesso : null;
  if (chave) return `NFe${chave}.xml`;
  const n = limpo(nota.numero);
  return n ? `NFe-${n}.xml` : 'NFe.xml';
}
