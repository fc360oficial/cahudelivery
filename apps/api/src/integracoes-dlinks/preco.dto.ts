import { IsNumber, IsOptional, IsString } from 'class-validator';

export class PrecoDto {
  @IsString()
  produto_codigo!: string;

  @IsString()
  tabela_id!: string;

  @IsNumber()
  valor!: number;

  @IsOptional()
  @IsNumber()
  percentual_max_desconto?: number;

  @IsOptional()
  @IsNumber()
  percentual_max_acrescimo?: number;
}
