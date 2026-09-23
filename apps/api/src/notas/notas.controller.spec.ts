import { NotFoundException } from '@nestjs/common';
import { NotasController } from './notas.controller';
import { assinarNota } from './assinatura';

const PEDIDO = '2a2d9a5b-5008-4016-bc23-dd8105434d6e';
const OUTRO = '11111111-2222-3333-4444-555555555555';

function montar() {
  const notas = { xml: jest.fn(), danfe: jest.fn() };
  const controller = new NotasController(notas as never);
  const res = { setHeader: jest.fn(), send: jest.fn() };
  return { controller, notas, res };
}

describe('NotasController', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'teste';
  });

  it('abre o DANFE com assinatura valida', async () => {
    const { controller, notas, res } = montar();
    const t = assinarNota('cahu', PEDIDO, 'pdf');
    notas.danfe.mockResolvedValue({ pdf: Buffer.from('pdf'), numero: '5060' });

    await controller.danfe('cahu', PEDIDO, t, res as never);

    expect(notas.danfe).toHaveBeenCalledWith(PEDIDO);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });

  it('recusa assinatura gerada para outro pedido, sem chamar o service', async () => {
    const { controller, notas, res } = montar();
    const t = assinarNota('cahu', OUTRO, 'pdf');

    await expect(controller.danfe('cahu', PEDIDO, t, res as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(notas.danfe).not.toHaveBeenCalled();
  });

  it('recusa quando falta o parametro t', async () => {
    const { controller, notas, res } = montar();

    await expect(controller.danfe('cahu', PEDIDO, undefined, res as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(notas.danfe).not.toHaveBeenCalled();
  });

  it('aceita o slug do tenant em maiuscula na URL quando a assinatura foi gerada em minuscula', async () => {
    const { controller, notas, res } = montar();
    const t = assinarNota('cahu', PEDIDO, 'pdf');
    notas.danfe.mockResolvedValue({ pdf: Buffer.from('pdf'), numero: '5060' });

    await controller.danfe('CAHU', PEDIDO, t, res as never);

    expect(notas.danfe).toHaveBeenCalledWith(PEDIDO);
    expect(res.send).toHaveBeenCalledWith(Buffer.from('pdf'));
  });

  it('abre o XML com assinatura valida', async () => {
    const { controller, notas, res } = montar();
    const t = assinarNota('cahu', PEDIDO, 'xml');
    notas.xml.mockResolvedValue({ xml: '<nfeProc/>', chave: '123', numero: '5060' });

    await controller.xml('cahu', PEDIDO, t, res as never);

    expect(notas.xml).toHaveBeenCalledWith(PEDIDO);
    expect(res.send).toHaveBeenCalledWith('<nfeProc/>');
  });
});

describe('cache das respostas', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'teste';
  });

  it('manda no-store no DANFE e no XML: a URL e fixa, o conteudo pode mudar', async () => {
    // 22/09/2026: apos o deploy do layout novo, o Chrome do celular seguiu
    // mostrando o DANFE antigo porque a resposta nao tinha Cache-Control.
    const { controller, notas, res } = montar();
    notas.danfe.mockResolvedValue({ pdf: Buffer.from('pdf'), numero: '5060' });
    notas.xml.mockResolvedValue({ xml: '<nfe/>', chave: '1'.repeat(44), numero: '5060' });

    await controller.danfe('cahu', PEDIDO, assinarNota('cahu', PEDIDO, 'pdf'), res as never);
    await controller.xml('cahu', PEDIDO, assinarNota('cahu', PEDIDO, 'xml'), res as never);

    const noStore = res.setHeader.mock.calls.filter(([nome, valor]) => nome === 'Cache-Control' && valor === 'no-store');
    expect(noStore).toHaveLength(2);
  });
});
