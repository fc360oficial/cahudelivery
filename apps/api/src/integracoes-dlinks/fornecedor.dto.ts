import { IsString } from 'class-validator';

export class FornecedorDto {
  @IsString()
  codigo!: string;

  @IsString()
  razao_social!: string;
}
