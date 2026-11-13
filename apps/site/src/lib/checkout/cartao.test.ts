import { describe, expect, it } from 'vitest';
import { lerValidade, luhnOk, resultadoCartao, retornoDoBanco, urlDesafioSegura, validarPagamentoCartao } from './cartao';

// Números de teste públicos (Visa 4111…, Mastercard 5555…): passam no Luhn, não são cartões reais.
const VISA = '4111111111111111';
const AGORA = new Date('2026-11-13T15:00:00-03:00');
const DISPOSITIVO = { altura: 900, largura: 1440, profundidadeCor: 24, idioma: 'pt-BR', fusoHoras: 3 };
const corpo = (extra: Record<string, unknown> = {}) => ({
  numero: '4111 1111 1111 1111', nome: '  MARIA DA SILVA ', validadeMes: 12, validadeAno: 2030, cvv: '123', dispositivo: DISPOSITIVO, ...extra,
});

describe('luhnOk', () => {
  it('confere o dígito verificador', () => {
    expect(luhnOk(VISA)).toBe(true);
    expect(luhnOk('5555555555554444')).toBe(true);
    expect(luhnOk('4111111111111112')).toBe(false);
  });
});

describe('validarPagamentoCartao (servidor: cartão + dados do navegador para o 3DS)', () => {
  it('aceita e normaliza: tira espaços do número, apara o nome', () => {
    expect(validarPagamentoCartao(corpo(), AGORA)).toEqual({
      numero: VISA, nome: 'MARIA DA SILVA', validadeMes: 12, validadeAno: 2030, cvv: '123', dispositivo: DISPOSITIVO,
    });
  });

  it('número: 13 a 19 dígitos, só dígitos e espaços, Luhn válido', () => {
    expect(validarPagamentoCartao(corpo({ numero: '4111-1111-1111-1111' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ numero: '411111111111' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ numero: '41111111111111111111' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ numero: '4111111111111112' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ numero: 4111111111111111 }), AGORA)).toBeNull();
  });

  it('nome 2 a 30; CVV 3 ou 4 dígitos', () => {
    expect(validarPagamentoCartao(corpo({ nome: 'A' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ nome: 'A'.repeat(31) }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ cvv: '12' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ cvv: '12345' }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ cvv: 123 }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ cvv: '1234' }), AGORA)?.cvv).toBe('1234');
  });

  it('validade: mês 1 a 12, ano plausível e não vencido', () => {
    expect(validarPagamentoCartao(corpo({ validadeMes: 13 }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ validadeMes: 0 }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ validadeMes: 1.5 }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ validadeAno: 2050 }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ validadeMes: 10, validadeAno: 2026 }), AGORA)).toBeNull(); // venceu em outubro
    expect(validarPagamentoCartao(corpo({ validadeMes: 11, validadeAno: 2026 }), AGORA)?.validadeMes).toBe(11); // vale até o fim do mês
  });

  it('dispositivo obrigatório e dentro dos limites da API; nada além dos campos conhecidos', () => {
    expect(validarPagamentoCartao(corpo({ dispositivo: undefined }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ dispositivo: { ...DISPOSITIVO, altura: 0 } }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ dispositivo: { ...DISPOSITIVO, fusoHoras: 15 } }), AGORA)).toBeNull();
    expect(validarPagamentoCartao(corpo({ dispositivo: { ...DISPOSITIVO, idioma: 'pt-BR<script>' } }), AGORA)).toBeNull();
    const r = validarPagamentoCartao(corpo({ dispositivo: { ...DISPOSITIVO, userAgent: 'outro', extra: 1 }, valor: 1 }), AGORA);
    expect(r?.dispositivo).toEqual(DISPOSITIVO);
    expect(r).not.toHaveProperty('valor');
    const semOpcionais = validarPagamentoCartao(corpo({ dispositivo: { altura: 900, largura: 1440, fusoHoras: -2 } }), AGORA);
    expect(semOpcionais?.dispositivo).toEqual({ altura: 900, largura: 1440, fusoHoras: -2 });
  });

  it('corpo que não é objeto', () => {
    expect(validarPagamentoCartao(null, AGORA)).toBeNull();
    expect(validarPagamentoCartao('x', AGORA)).toBeNull();
  });
});

describe('lerValidade (campo MM/AA do formulário)', () => {
  it('MM/AA vira mês e ano com 4 dígitos', () => {
    expect(lerValidade('12/30')).toEqual({ mes: 12, ano: 2030 });
    expect(lerValidade('0130')).toEqual({ mes: 1, ano: 2030 });
    expect(lerValidade('1/30')).toBeNull();
    expect(lerValidade('13/30')).toBeNull();
    expect(lerValidade('')).toBeNull();
  });
});

describe('urlDesafioSegura (para onde o navegador vai no 3DS)', () => {
  it('só https absoluta, sem usuário/senha', () => {
    expect(urlDesafioSegura('https://3ds.banco.com.br/desafio?id=1')).toBe('https://3ds.banco.com.br/desafio?id=1');
    expect(urlDesafioSegura('http://3ds.banco.com.br/x')).toBeNull();
    expect(urlDesafioSegura('javascript:alert(1)')).toBeNull();
    expect(urlDesafioSegura('https://u:s@banco.com/x')).toBeNull();
    expect(urlDesafioSegura('/conta')).toBeNull();
    expect(urlDesafioSegura(42)).toBeNull();
  });
});

describe('resultadoCartao (resposta da API → navegador)', () => {
  it('pago, recusado com a mensagem, autenticar com a URL segura', () => {
    expect(resultadoCartao({ status: 'pago' })).toEqual({ status: 'pago' });
    expect(resultadoCartao({ status: 'recusado', codigo: '05', mensagem: 'Não autorizada' })).toEqual({ status: 'recusado', mensagem: 'Não autorizada' });
    expect(resultadoCartao({ status: 'recusado' })).toEqual({ status: 'recusado', mensagem: 'Pagamento recusado. Tente outro cartão.' });
    expect(resultadoCartao({ status: 'autenticar', urlAutenticacao: 'https://banco.com/3ds', mensagem: 'Conclua' }))
      .toEqual({ status: 'autenticar', urlAutenticacao: 'https://banco.com/3ds' });
  });
  it('autenticar sem URL segura ou status desconhecido: não segue (nunca "pago" por engano)', () => {
    expect(resultadoCartao({ status: 'autenticar', urlAutenticacao: 'http://banco.com/3ds' })).toEqual({ status: 'indefinido' });
    expect(resultadoCartao({ status: 'outro' })).toEqual({ status: 'indefinido' });
    expect(resultadoCartao(null)).toEqual({ status: 'indefinido' });
  });
});

describe('retornoDoBanco (?pagamento= é só uma dica para conferir)', () => {
  it('ok ou falhou; o resto é nulo', () => {
    expect(retornoDoBanco('ok')).toBe('ok');
    expect(retornoDoBanco('falhou')).toBe('falhou');
    expect(retornoDoBanco('pago')).toBeNull();
    expect(retornoDoBanco(null)).toBeNull();
  });
});
