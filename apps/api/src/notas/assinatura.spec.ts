import { assinarNota, assinaturaConfere, urlNota } from './assinatura';

describe('assinatura das URLs de nota', () => {
  const PEDIDO = '2a2d9a5b-5008-4016-bc23-dd8105434d6e';
  const OUTRO = '11111111-2222-3333-4444-555555555555';

  beforeEach(() => {
    process.env.JWT_SECRET = 'segredo-de-teste';
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org';
  });

  it('e estavel: a mesma entrada gera sempre a mesma assinatura', () => {
    expect(assinarNota('cahu', PEDIDO, 'pdf')).toBe(assinarNota('cahu', PEDIDO, 'pdf'));
  });

  it('separa tipo, pedido e tenant', () => {
    const pdf = assinarNota('cahu', PEDIDO, 'pdf');
    expect(assinarNota('cahu', PEDIDO, 'xml')).not.toBe(pdf);
    expect(assinarNota('cahu', OUTRO, 'pdf')).not.toBe(pdf);
    expect(assinarNota('outro', PEDIDO, 'pdf')).not.toBe(pdf);
  });

  it('aceita a assinatura correta', () => {
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', PEDIDO, 'pdf'))).toBe(true);
  });

  it('recusa assinatura de outro pedido, tipo trocado, vazia ou malformada', () => {
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', OUTRO, 'pdf'))).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', assinarNota('cahu', PEDIDO, 'xml'))).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', undefined)).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', '')).toBe(false);
    expect(assinaturaConfere('cahu', PEDIDO, 'pdf', 'xx')).toBe(false); // tamanho diferente
  });

  it('monta a URL absoluta com o tenant no caminho', () => {
    const url = urlNota('cahu', PEDIDO, 'pdf');
    expect(url).toBe(
      `https://cahudelivery.duckdns.org/v1/notas/cahu/${PEDIDO}/danfe.pdf?t=${assinarNota('cahu', PEDIDO, 'pdf')}`,
    );
    expect(urlNota('cahu', PEDIDO, 'xml')).toContain(`/v1/notas/cahu/${PEDIDO}/nota.xml?t=`);
  });

  it('devolve null quando PUBLIC_URL nao esta configurada', () => {
    delete process.env.PUBLIC_URL;
    expect(urlNota('cahu', PEDIDO, 'pdf')).toBeNull();
  });

  it('tira a barra final de PUBLIC_URL para nao gerar URL com barra dupla', () => {
    process.env.PUBLIC_URL = 'https://cahudelivery.duckdns.org/';
    expect(urlNota('cahu', PEDIDO, 'pdf')).toContain('.org/v1/notas/');
    expect(urlNota('cahu', PEDIDO, 'pdf')).not.toContain('//v1/');
  });
});
