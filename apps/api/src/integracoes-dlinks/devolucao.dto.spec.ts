import { BadRequestException } from '@nestjs/common';
import { DevolucaoDto } from './devolucao.dto';
import { ListaOuItemPipe } from './lista-ou-item.pipe';

describe('DevolucaoDto via ListaOuItemPipe', () => {
  const pipe = new ListaOuItemPipe(DevolucaoDto);
  const ok = { numero_nota: '900', data: '2026-11-12', valor: 500, pedido_codigo: '22222222-2222-4222-8222-222222222222' };

  it('aceita item, lista e os campos opcionais', async () => {
    await expect(pipe.transform(ok)).resolves.toHaveLength(1);
    await expect(
      pipe.transform([ok, { numero_nota: '901', serie: '1', data: '2026-11-12T10:30:00-03:00', valor: 0, funcionario_codigo: '6', cliente_codigo: 'C1', nota_venda_numero: '1234', cancelada: true }]),
    ).resolves.toHaveLength(2);
  });

  it('rejeita nota vazia, data inválida, valor negativo ou em texto', async () => {
    await expect(pipe.transform([{ ...ok, numero_nota: '' }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ ...ok, data: '12/11/2026' }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ ...ok, valor: -1 }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ ...ok, valor: '500' }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ ...ok, cancelada: 'sim' }])).rejects.toThrow(BadRequestException);
  });
});
