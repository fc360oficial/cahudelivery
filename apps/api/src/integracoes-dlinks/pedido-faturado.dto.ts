import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

const STATUS = ['ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO'] as const;

export class ItemFaturadoDto {
  @IsString()
  produto_codigo!: string;

  @IsNumber()
  quantidade!: number;

  @IsNumber()
  valor_unitario!: number;
}

export class ValoresFaturadoDto {
  @IsNumber()
  subtotal!: number;

  @IsOptional()
  @IsNumber()
  desconto?: number;

  @IsNumber()
  total!: number;
}

export class PedidoFaturadoDto {
  @IsString()
  pedido_codigo!: string;

  @IsIn(STATUS)
  status!: (typeof STATUS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => ValoresFaturadoDto)
  valores?: ValoresFaturadoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemFaturadoDto)
  itens?: ItemFaturadoDto[];
}
