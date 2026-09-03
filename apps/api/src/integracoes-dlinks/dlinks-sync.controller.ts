import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DlinksSyncService } from './dlinks-sync.service';
import { GrupoDto } from './grupo.dto';
import { FornecedorDto } from './fornecedor.dto';
import { ProdutoSyncDto } from './produto-sync.dto';
import { TabelaPrecoDto } from './tabela-preco.dto';
import { PrecoDto } from './preco.dto';
import { ClienteDto } from './cliente.dto';
import { FormaPagamentoDto } from './forma-pagamento.dto';
import { CondicaoPagamentoDto } from './condicao-pagamento.dto';
import { TituloDto } from './titulo.dto';

@Controller('integracoes/dlinks')
export class DlinksSyncController {
  constructor(private readonly service: DlinksSyncService) {}

  @Post('grupos')
  @HttpCode(200)
  grupos(@Body() body: GrupoDto) {
    return this.service.syncGrupos([body]);
  }

  @Post('fornecedores')
  @HttpCode(200)
  fornecedores(@Body() body: FornecedorDto) {
    return this.service.syncFornecedores([body]);
  }

  @Post('tabelas-de-precos')
  @HttpCode(200)
  tabelasDePrecos(@Body() body: TabelaPrecoDto) {
    return this.service.syncTabelasPreco([body]);
  }

  @Post('produtos')
  @HttpCode(200)
  produtos(@Body() body: ProdutoSyncDto) {
    return this.service.syncProdutos([body]);
  }

  @Post('precos')
  @HttpCode(200)
  precos(@Body() body: PrecoDto) {
    return this.service.syncPrecos([body]);
  }

  @Post('clientes')
  @HttpCode(200)
  clientes(@Body() body: ClienteDto) {
    return this.service.syncClientes([body]);
  }

  @Post('formaspagamento')
  @HttpCode(200)
  formasPagamento(@Body() body: FormaPagamentoDto) {
    return this.service.syncFormasPagamento([body]);
  }

  @Post('condicoespagamento')
  @HttpCode(200)
  condicoesPagamento(@Body() body: CondicaoPagamentoDto) {
    return this.service.syncCondicoesPagamento([body]);
  }

  @Post('titulos')
  @HttpCode(200)
  titulos(@Body() body: TituloDto) {
    return this.service.syncTitulos([body]);
  }
}
