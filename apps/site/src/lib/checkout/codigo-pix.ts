/** Copia-e-cola PIX (BR Code): texto ASCII imprimível de uma linha. O EMV tem bem menos de 512. */
export function codigoPixValido(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 512 && /^[\x20-\x7E]+$/.test(v);
}
