import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ClienteFuncionarioDto } from './cliente-funcionario.dto';
import { DevolucaoDto } from './devolucao.dto';
import { DlinksVendedoresService } from './dlinks-vendedores.service';
import { FuncionarioDto } from './funcionario.dto';
import { ListaOuItemPipe } from './lista-ou-item.pipe';
import { VendaVendedorDto } from './venda-vendedor.dto';

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

  @Post('vendas-vendedores')
  @HttpCode(200)
  vendas(@Body(new ListaOuItemPipe(VendaVendedorDto)) itens: VendaVendedorDto[]) {
    return this.service.syncFaturamentoMensal(itens);
  }

  @Post('devolucoes')
  @HttpCode(200)
  devolucoes(@Body(new ListaOuItemPipe(DevolucaoDto)) itens: DevolucaoDto[]) {
    return this.service.syncDevolucoes(itens);
  }
}
