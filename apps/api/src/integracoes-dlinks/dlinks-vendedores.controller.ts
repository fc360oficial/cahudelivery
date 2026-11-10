import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import { DlinksVendedoresService } from './dlinks-vendedores.service';
import { FuncionarioDto } from './funcionario.dto';
import { ListaOuItemPipe } from './lista-ou-item.pipe';

@Controller('integracoes/dlinks')
export class DlinksVendedoresController {
  constructor(private readonly service: DlinksVendedoresService) {}

  @Post('funcionarios')
  @HttpCode(200)
  funcionarios(@Body(new ListaOuItemPipe(FuncionarioDto)) itens: FuncionarioDto[]) {
    return this.service.syncFuncionarios(itens);
  }

  @Post('clientes-funcionarios')
  @HttpCode(200)
  carteira(@Body(new ListaOuItemPipe(ClienteFuncionarioDto)) itens: ClienteFuncionarioDto[]) {
    return this.service.syncCarteira(itens);
  }
}
