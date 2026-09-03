import { IsIn, IsString } from 'class-validator';

const STATUS = ['ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO'] as const;

export class PedidoFaturadoDto {
  @IsString()
  pedido_codigo!: string;

  @IsIn(STATUS)
  status!: (typeof STATUS)[number];
}
