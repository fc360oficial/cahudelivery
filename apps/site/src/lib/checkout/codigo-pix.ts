/**
 * Copia-e-cola PIX (BR Code): texto imprimível de uma linha, até 512 caracteres (o EMV tem bem
 * menos). Aceita acento (nome e cidade do recebedor podem ter): o código nunca entra no SVG
 * como texto e o React escapa o campo. Recusa controle, formatação invisível (p.ex. inversão de
 * direção) e quebra de linha/parágrafo.
 */
const IMPRIMIVEL = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]+$/u;

export function codigoPixValido(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 512 && IMPRIMIVEL.test(v);
}
