import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class FuncionarioDto {
  @IsString()
  codigo!: string;

  @IsString()
  nome!: string;

  @IsOptional()
  @IsString()
  filial_codigo?: string;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
