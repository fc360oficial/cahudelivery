import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

const UNIDADES = ['UN', 'CX', 'FD', 'PC', 'KG'] as const;

export class ProdutoSyncDto {
  @IsString()
  codigo!: string;

  @IsString()
  fornecedor_codigo!: string;

  @IsString()
  grupo_codigo!: string;

  @IsString()
  descricao!: string;

  @IsOptional()
  @IsNumber()
  multiplo_venda?: number;

  @IsOptional()
  @IsNumber()
  estoque?: number;

  @IsIn(UNIDADES)
  unidade!: (typeof UNIDADES)[number];
}
