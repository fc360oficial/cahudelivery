// Tipos mínimos do pacote `qrcode` (só o que o site usa), para não somar @types/qrcode.
declare module 'qrcode' {
  interface OpcoesSvg {
    type: 'svg';
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    margin?: number;
    width?: number;
    color?: { dark?: string; light?: string };
  }
  const QRCode: { toString(texto: string, opcoes: OpcoesSvg): Promise<string> };
  export default QRCode;
}
