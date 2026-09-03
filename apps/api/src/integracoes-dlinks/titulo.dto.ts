import { IsDateString, IsNumber, IsString } from 'class-validator';

export class TituloDto {
  @IsString()
  numero_titulo!: string;

  @IsString()
  cliente_codigo!: string;

  @IsNumber()
  valor!: number;

  @IsDateString()
  vencimento!: string;

  @IsString()
  status!: string;
}
