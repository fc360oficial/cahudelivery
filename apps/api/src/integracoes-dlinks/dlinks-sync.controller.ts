import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { DlinksSyncService } from './dlinks-sync.service';
import { GrupoDto } from './grupo.dto';
import { FornecedorDto } from './fornecedor.dto';
import { ProdutoSyncDto } from './produto-sync.dto';
import { TabelaPrecoDto } from './tabela-preco.dto';
import { PrecoDto } from './preco.dto';

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
}
