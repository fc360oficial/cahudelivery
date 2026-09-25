/**
 * Monta o payload EMV "PIX copia e cola" de um QR dinâmico (BCB, Manual de
 * Padrões para Iniciação do Pix). Usado só quando o provedor não devolve o
 * campo pixCopiaECola pronto.
 */
function campo(id: string, valor: string): string {
  const len = valor.length.toString().padStart(2, '0');
  return `${id}${len}${valor}`;
}

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), hex maiúsculo com 4 dígitos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
}

export function montarBrCode(o: { location: string; nomeRecebedor: string; cidade: string; txid: string }): string {
  const nome = semAcento(o.nomeRecebedor).slice(0, 25);
  const cidade = semAcento(o.cidade).slice(0, 15);
  const semCrc =
    campo('00', '01') +
    campo('26', campo('00', 'br.gov.bcb.pix') + campo('25', o.location)) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('58', 'BR') +
    campo('59', nome) +
    campo('60', cidade) +
    campo('62', campo('05', o.txid)) +
    '6304';
  return semCrc + crc16(semCrc);
}
