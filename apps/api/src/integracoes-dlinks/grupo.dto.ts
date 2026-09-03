import { IsString } from 'class-validator';

export class GrupoDto {
  @IsString()
  codigo!: string;

  @IsString()
  descricao!: string;
}
