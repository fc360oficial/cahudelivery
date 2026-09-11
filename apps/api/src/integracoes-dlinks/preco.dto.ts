import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PrecoDto {
  @IsString()
  @IsNotEmpty()
  produto_codigo!: string;

  @IsString()
  @IsNotEmpty({ message: 'tabela_id não pode ser vazio (código da tabela de preço enviada em /tabelas-de-precos)' })
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
