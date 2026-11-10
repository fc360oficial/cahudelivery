import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ClienteFuncionarioDto {
  @IsString()
  @IsNotEmpty()
  cliente_codigo!: string;

  @IsOptional()
  @IsString()
  funcionario_codigo?: string | null;
}
