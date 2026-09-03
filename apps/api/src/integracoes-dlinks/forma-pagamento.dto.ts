import { IsString } from 'class-validator';

export class FormaPagamentoDto {
  @IsString()
  codigo!: string;

  @IsString()
  descricao!: string;
}
