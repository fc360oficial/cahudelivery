import { IsString } from 'class-validator';

export class ClienteFuncionarioDto {
  @IsString()
  cliente_codigo!: string;

  @IsString()
  funcionario_codigo!: string;
}
