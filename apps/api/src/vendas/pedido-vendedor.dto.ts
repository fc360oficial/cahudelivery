// apps/api/src/vendas/pedido-vendedor.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID,
  Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class ItemPedidoVendedorDto {
  @IsUUID() produtoId!: string;
  @IsNumber() @IsPositive() @Max(9999999) quantidade!: number;
  @IsNumber() @Min(0) @Max(99999999) precoUnit!: number;
}

export class PedidoVendedorDto {
  /** Gerado no aparelho; reenvio com o mesmo valor devolve o mesmo pedido. */
  @IsUUID() idDispositivo!: string;
  @IsUUID() clienteId!: string;
  @IsUUID() tabelaPrecoId!: string;
  @IsUUID() formaPagamentoId!: string;
  @IsIn(['entrega', 'retirada']) tipoEntrega!: 'entrega' | 'retirada';
  @IsOptional() @IsString() @MaxLength(500) observacoes?: string;
  @IsOptional() @IsUUID() orcamentoId?: string;
  @IsDateString() criadoNoAparelhoEm!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ItemPedidoVendedorDto)
  itens!: ItemPedidoVendedorDto[];
}
