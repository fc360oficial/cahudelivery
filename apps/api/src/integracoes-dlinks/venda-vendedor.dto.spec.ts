import { BadRequestException } from '@nestjs/common';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { VendaVendedorDto } from './venda-vendedor.dto';

describe('VendaVendedorDto via ListaOuItemPipe', () => {
  const pipe = new ListaOuItemPipe(VendaVendedorDto);
  const ok = { funcionario_codigo: '6', ano_mes: '2026-10', valor_faturado: 1500.5 };

  it('aceita item e lista', async () => {
    await expect(pipe.transform(ok)).resolves.toHaveLength(1);
    await expect(pipe.transform([ok, { ...ok, valor_faturado: 0 }])).resolves.toHaveLength(2);
  });

  it.each(['2026-13', '2026-00', '26-10', '2026/10', '2026-1', ''])('rejeita ano_mes %p', async (ano_mes) => {
    await expect(pipe.transform([{ ...ok, ano_mes }])).rejects.toThrow(BadRequestException);
  });

  it('rejeita valor negativo, texto e campo ausente', async () => {
    await expect(pipe.transform([{ ...ok, valor_faturado: -1 }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ ...ok, valor_faturado: '10' }])).rejects.toThrow(BadRequestException);
    await expect(pipe.transform([{ funcionario_codigo: '6', ano_mes: '2026-10' }])).rejects.toThrow(BadRequestException);
  });

  it('rejeita funcionario_codigo vazio', async () => {
    await expect(pipe.transform([{ ...ok, funcionario_codigo: '' }])).rejects.toThrow(BadRequestException);
  });
});
