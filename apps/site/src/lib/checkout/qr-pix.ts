import 'server-only';
import QRCode from 'qrcode';
import { codigoPixValido } from './codigo-pix';

export { codigoPixValido };

/**
 * QR do PIX desenhado no servidor do site, a partir do copia-e-cola que a API devolveu (nenhum
 * serviço externo). SVG só com formas: o texto do código não vai dentro do desenho.
 */
export async function svgDoPix(copiaCola: string): Promise<string> {
  if (!codigoPixValido(copiaCola)) throw new Error('código PIX inválido');
  return QRCode.toString(copiaCola, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
}
