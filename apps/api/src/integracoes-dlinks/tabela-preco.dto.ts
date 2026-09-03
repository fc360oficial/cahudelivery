import { IsString } from 'class-validator';

export class TabelaPrecoDto {
  @IsString()
  id!: string;

  @IsString()
  descricao!: string;
}
