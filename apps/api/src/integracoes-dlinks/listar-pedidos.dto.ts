import { IsDateString } from 'class-validator';

export class ListarPedidosDto {
  @IsDateString()
  data_inicial!: string;

  @IsDateString()
  data_final!: string;
}
