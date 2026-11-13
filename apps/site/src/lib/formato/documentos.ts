const VAZIO = '—';
const digitos = (v: string) => v.replace(/\D/g, '');

/** CPF "000.000.000-00" ou CNPJ "00.000.000/0000-00"; o resto volta como veio. */
export function formatarDocumento(doc: string | null | undefined): string {
  if (!doc) return VAZIO;
  const d = digitos(doc);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return doc;
}

export function formatarCep(cep: string | null | undefined): string {
  if (!cep) return VAZIO;
  const d = digitos(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

/** "(81) 99999-0000" ou "(81) 3333-4444"; tira o 55 do país. */
export function formatarTelefone(tel: string | null | undefined): string {
  if (!tel) return VAZIO;
  let d = digitos(tel);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}
