import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PedidoFaturadoDto } from './pedido-faturado.dto';

const CHAVE = '26260961920643000148550030000050601000073367';

const payload = (nota?: Record<string, unknown>) => ({
  pedido_codigo: '2a2d9a5b-5008-4016-bc23-dd8105434d6e',
  status: 'FATURADO',
  valores: { subtotal: 23400, desconto: 0, total: 23400 },
  itens: [{ produto_codigo: '7891008367027', quantidade: 6, valor_unitario: 39 }],
  ...(nota === undefined ? {} : { nota_fiscal: nota }),
});

const notaValida = {
  chave: CHAVE,
  numero: '5060',
  serie: '3',
  emitida_em: '2026-09-22T00:00:00-03:00',
  xml_base64: 'PG5mZVByb2MvPg==',
};

const converter = (bruto: unknown) =>
  plainToInstance(PedidoFaturadoDto, bruto, { excludeExtraneousValues: false });

describe('PedidoFaturadoDto e o bloco nota_fiscal', () => {
  it('nao perde nota_fiscal na conversao (regressao do bug de 22/09/2026)', async () => {
    const dto = converter(payload(notaValida));
    expect(dto.nota_fiscal).toBeDefined();
    expect(dto.nota_fiscal!.chave).toBe(CHAVE);
    expect(dto.nota_fiscal!.numero).toBe('5060');
    expect(dto.nota_fiscal!.serie).toBe('3');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('continua aceitando payload sem nota_fiscal', async () => {
    const dto = converter(payload());
    expect(dto.nota_fiscal).toBeUndefined();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('recusa chave com menos de 44 digitos', async () => {
    const erros = await validate(converter(payload({ ...notaValida, chave: '2626096192064300014855003000005060100007336' })));
    expect(erros).not.toHaveLength(0);
  });

  it('recusa chave com letra', async () => {
    const erros = await validate(converter(payload({ ...notaValida, chave: `X${CHAVE.slice(1)}` })));
    expect(erros).not.toHaveLength(0);
  });

  it('recusa nota_fiscal sem xml_base64', async () => {
    const { xml_base64, ...semXml } = notaValida;
    const erros = await validate(converter(payload(semXml)));
    expect(erros).not.toHaveLength(0);
  });

  it('aceita nota_fiscal sem emitida_em, que e opcional', async () => {
    const { emitida_em, ...semData } = notaValida;
    expect(await validate(converter(payload(semData)))).toHaveLength(0);
  });

  it('mantem numero e serie como texto, sem virar numero', async () => {
    const dto = converter(payload({ ...notaValida, serie: '03' }));
    expect(dto.nota_fiscal!.serie).toBe('03'); // zero à esquerda preservado
    expect(typeof dto.nota_fiscal!.numero).toBe('string');
  });
});
