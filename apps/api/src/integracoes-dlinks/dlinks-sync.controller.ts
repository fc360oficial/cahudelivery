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
import { ListaOuItemPipe } from './lista-ou-item.pipe';

/**
 * Todos os endpoints aceitam no body tanto um item único quanto
 * uma lista de itens (formato que o Dlinks envia em lote).
 */
@Controller('integracoes/dlinks')
export class DlinksSyncController {
  constructor(private readonly service: DlinksSyncService) {}

  @Post('grupos')
  @HttpCode(200)
  grupos(@Body(new ListaOuItemPipe(GrupoDto)) itens: GrupoDto[]) {
    return this.service.syncGrupos(itens);
  }

  @Post('fornecedores')
  @HttpCode(200)
  fornecedores(@Body(new ListaOuItemPipe(FornecedorDto)) itens: FornecedorDto[]) {
    return this.service.syncFornecedores(itens);
  }

  @Post('tabelas-de-precos')
  @HttpCode(200)
  tabelasDePrecos(@Body(new ListaOuItemPipe(TabelaPrecoDto)) itens: TabelaPrecoDto[]) {
    return this.service.syncTabelasPreco(itens);
  }

  @Post('produtos')
  @HttpCode(200)
  produtos(@Body(new ListaOuItemPipe(ProdutoSyncDto)) itens: ProdutoSyncDto[]) {
    return this.service.syncProdutos(itens);
  }

  @Post('precos')
  @HttpCode(200)
  precos(@Body(new ListaOuItemPipe(PrecoDto)) itens: PrecoDto[]) {
    return this.service.syncPrecos(itens);
  }

  @Post('clientes')
  @HttpCode(200)
  clientes(@Body(new ListaOuItemPipe(ClienteDto)) itens: ClienteDto[]) {
    return this.service.syncClientes(itens);
  }

  @Post('formaspagamento')
  @HttpCode(200)
  formasPagamento(@Body(new ListaOuItemPipe(FormaPagamentoDto)) itens: FormaPagamentoDto[]) {
    return this.service.syncFormasPagamento(itens);
  }

  @Post('condicoespagamento')
  @HttpCode(200)
  condicoesPagamento(@Body(new ListaOuItemPipe(CondicaoPagamentoDto)) itens: CondicaoPagamentoDto[]) {
    return this.service.syncCondicoesPagamento(itens);
  }

  @Post('titulos')
  @HttpCode(200)
  titulos(@Body(new ListaOuItemPipe(TituloDto)) itens: TituloDto[]) {
    return this.service.syncTitulos(itens);
  }
}
