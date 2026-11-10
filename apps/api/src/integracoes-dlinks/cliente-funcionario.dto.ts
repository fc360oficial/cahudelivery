import { IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class ClienteFuncionarioDto {
  @IsString()
  @IsNotEmpty()
  cliente_codigo!: string;

  /** null ou '' = cliente sem vendedor (sai de todas as carteiras). Campo ausente é erro. */
  @ValidateIf((o: ClienteFuncionarioDto) => o.funcionario_codigo !== null)
  @IsString()
  funcionario_codigo!: string | null;
}
