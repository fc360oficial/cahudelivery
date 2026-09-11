import { BadRequestException } from '@nestjs/common';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { ProdutoSyncDto } from './produto-sync.dto';

describe('ListaOuItemPipe', () => {
  const pipe = new ListaOuItemPipe(ProdutoSyncDto);
  const item = {
    codigo: '7896012300213',
    fornecedor_codigo: '0',
    grupo_codigo: '29',
    descricao: 'EMOCOES ARROZ 1KG PARBOILIZADO',
    unidade: 'CX',
    multiplo_venda: 10,
  };

  it('aceita uma lista de itens (formato que o Dlinks envia)', async () => {
    const out = await pipe.transform([item, { ...item, codigo: '7891515430412' }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(ProdutoSyncDto);
    expect(out[1].codigo).toBe('7891515430412');
  });

  it('aceita um objeto único e devolve lista de 1', async () => {
    const out = await pipe.transform(item);
    expect(out).toHaveLength(1);
    expect(out[0].descricao).toBe(item.descricao);
  });

  it('aceita código de barras com até 18 dígitos', async () => {
    const out = await pipe.transform({ ...item, codigo: '123456789012345678' });
    expect(out[0].codigo).toBe('123456789012345678');
  });

  it('rejeita item inválido informando a posição na lista', async () => {
    await expect(pipe.transform([item, { ...item, unidade: 'XX' }])).rejects.toThrow(BadRequestException);
    try {
      await pipe.transform([item, { ...item, unidade: 'XX' }]);
    } catch (e) {
      const msg = JSON.stringify((e as BadRequestException).getResponse());
      expect(msg).toContain('[1]');
      expect(msg).toContain('unidade');
    }
  });

  it('rejeita lista vazia', async () => {
    await expect(pipe.transform([])).rejects.toThrow(BadRequestException);
  });

  it('remove campos desconhecidos (whitelist)', async () => {
    const out = await pipe.transform({ ...item, campo_extra: 'x' });
    expect((out[0] as unknown as Record<string, unknown>).campo_extra).toBeUndefined();
  });
});
