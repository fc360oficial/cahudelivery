import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class FuncionarioDto {
  @IsString()
  @IsNotEmpty()
  codigo!: string;

  @IsString()
  @IsNotEmpty()
  nome!: string;

  @IsOptional()
  @IsString()
  filial_codigo?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
