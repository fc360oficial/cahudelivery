import { describe, expect, it } from 'vitest';
import { caminhoArquivoNota, nomeArquivoNota } from './notas';

const ID = '9c53dfb2-a0e3-42bf-9cf5-ff1f7944e295';
const T = '0123456789abcdef0123456789abcdef';
const url = (arquivo: string, extra = '') => `https://api.exemplo.com.br/v1/notas/cahu/${ID}/${arquivo}?t=${T}${extra}`;

describe('caminhoArquivoNota', () => {
  it('tira da URL assinada só o caminho relativo à API, sem o host', () => {
    expect(caminhoArquivoNota(url('danfe.pdf'), ID, 'danfe', 'cahu')).toBe(`/notas/cahu/${ID}/danfe.pdf?t=${T}`);
    expect(caminhoArquivoNota(url('nota.xml'), ID, 'xml', 'cahu')).toBe(`/notas/cahu/${ID}/nota.xml?t=${T}`);
  });
  it('host interno ou outro prefixo não importam: o host da API é sempre o do servidor', () => {
    expect(caminhoArquivoNota(`http://10.0.0.5:3000/v1/notas/cahu/${ID}/danfe.pdf?t=${T}`, ID, 'danfe', 'cahu'))
      .toBe(`/notas/cahu/${ID}/danfe.pdf?t=${T}`);
  });
  it('recusa arquivo trocado, pedido diferente, outro tenant, assinatura fora do formato e lixo', () => {
    expect(caminhoArquivoNota(url('nota.xml'), ID, 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota(url('danfe.pdf'), '11111111-1111-4111-8111-111111111111', 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota(url('danfe.pdf'), ID, 'danfe', 'outro')).toBeNull();
    expect(caminhoArquivoNota(url('danfe.pdf').replace(T, 'zz'), ID, 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota(`https://x/v1/notas/cahu/${ID}/danfe.pdf`, ID, 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota(`https://x/v1/notas/cahu/${ID}/../../perfil?t=${T}`, ID, 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota(null, ID, 'danfe', 'cahu')).toBeNull();
    expect(caminhoArquivoNota('não é url', ID, 'danfe', 'cahu')).toBeNull();
  });
  it('tenant comparado sem diferença de maiúsculas', () => {
    expect(caminhoArquivoNota(url('danfe.pdf'), ID, 'danfe', 'CAHU')).toBe(`/notas/cahu/${ID}/danfe.pdf?t=${T}`);
  });
});

describe('nomeArquivoNota', () => {
  it('DANFE pelo número e XML pela chave, só com caracteres seguros', () => {
    expect(nomeArquivoNota('danfe', { numero: '1234', chaveAcesso: null })).toBe('DANFE-1234.pdf');
    expect(nomeArquivoNota('xml', { numero: '1234', chaveAcesso: '2'.repeat(44) })).toBe(`NFe${'2'.repeat(44)}.xml`);
    expect(nomeArquivoNota('xml', { numero: '12"; x=1', chaveAcesso: null })).toBe('NFe-12x1.xml');
    expect(nomeArquivoNota('danfe', { numero: '', chaveAcesso: null })).toBe('DANFE.pdf');
  });
});
