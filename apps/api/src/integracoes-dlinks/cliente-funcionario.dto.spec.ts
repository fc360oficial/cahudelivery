import { BadRequestException } from '@nestjs/common';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';

describe('ClienteFuncionarioDto via ListaOuItemPipe', () => {
  const pipe = new ListaOuItemPipe(ClienteFuncionarioDto);

  it('rejeita item sem funcionario_codigo (campo ausente)', async () => {
    await expect(pipe.transform([{ cliente_codigo: 'C1' }])).rejects.toThrow(BadRequestException);
  });

  it('rejeita chave com nome errado', async () => {
    await expect(pipe.transform([{ cliente_codigo: 'C1', vendedor_codigo: '6' }])).rejects.toThrow(BadRequestException);
  });

  it('aceita null explícito (cliente sem vendedor)', async () => {
    await expect(pipe.transform([{ cliente_codigo: 'C1', funcionario_codigo: null }])).resolves.toHaveLength(1);
  });

  it('aceita string vazia explícita', async () => {
    await expect(pipe.transform([{ cliente_codigo: 'C1', funcionario_codigo: '' }])).resolves.toHaveLength(1);
  });

  it('aceita código de vendedor', async () => {
    await expect(pipe.transform([{ cliente_codigo: 'C1', funcionario_codigo: '6' }])).resolves.toHaveLength(1);
  });
});
