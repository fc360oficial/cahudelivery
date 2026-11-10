// apps/api/src/vendas/orcamento.dto.ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ItemPedidoVendedorDto } from './pedido-vendedor.dto';

export class OrcamentoDto {
  @IsUUID() clienteId!: string;
  @IsUUID() tabelaPrecoId!: string;
  @IsOptional() @IsUUID() formaPagamentoId?: string;
  @IsIn(['entrega', 'retirada']) tipoEntrega!: 'entrega' | 'retirada';
  @IsOptional() @IsString() @MaxLength(500) observacoes?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoVendedorDto)
  itens!: ItemPedidoVendedorDto[];
}
