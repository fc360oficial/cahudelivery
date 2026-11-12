const UUID_NO_FIM = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UUID_INTEIRO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugificar(texto: string): string {
  const slug = texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'item';
}

/** O id é o que identifica; o slug é só enfeite do endereço. */
export function idDoSegmento(segmento: string): string | null {
  const m = UUID_NO_FIM.exec(segmento);
  return m ? m[0].toLowerCase() : null;
}

export function caminhoProduto(p: { id: string; nome: string }): string {
  return `/p/${slugificar(p.nome)}-${p.id}`;
}

export function caminhoCategoria(c: { id: string; nome: string }): string {
  return `/c/${slugificar(c.nome)}-${c.id}`;
}
