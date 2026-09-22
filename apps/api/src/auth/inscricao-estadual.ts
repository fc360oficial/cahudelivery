export interface EntradaIe {
  tipo: 'CPF' | 'CNPJ';
  inscricaoEstadual?: string;
  isentoIe?: boolean;
}

export type ResultadoIe = { ok: true; valor: string | null } | { ok: false; erro: string };

/**
 * Regra da IE no cadastro, isolada aqui para ser testável sem banco.
 *
 * Devolve o que gravar em `clientes.inscricao_estadual`: `null` para CPF,
 * a string literal `ISENTO` para quem marcou isento, ou só os dígitos da IE.
 *
 * Não valida dígito verificador: cada UF tem sua própria regra e manter as 27
 * não compensa. Só o comprimento (8 a 14) é conferido — IE errada aparece no ERP.
 */
export function resolverInscricaoEstadual(e: EntradaIe): ResultadoIe {
  if (e.tipo !== 'CNPJ') return { ok: true, valor: null };
  if (e.isentoIe === true) return { ok: true, valor: 'ISENTO' };
  const digitos = (e.inscricaoEstadual ?? '').replace(/\D/g, '');
  if (!digitos) return { ok: false, erro: 'Informe a Inscricao Estadual ou marque Isento' };
  if (digitos.length < 8 || digitos.length > 14) return { ok: false, erro: 'Inscricao Estadual invalida' };
  return { ok: true, valor: digitos };
}
