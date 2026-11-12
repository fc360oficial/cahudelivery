import {
  IsBoolean, IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min,
} from 'class-validator';

/**
 * Devolução de venda, como o ERP envia: uma nota de devolução que referencia uma venda.
 * O vendedor vem do pedido (`pedido_codigo`, o mesmo código de /pedidos-faturados) ou, quando a venda
 * não nasceu no aplicativo, de `funcionario_codigo`. Pelo menos um dos dois é obrigatório (conferido no serviço).
 */
export class DevolucaoDto {
  /** Número da nota de devolução. Com `serie`, identifica a devolução: reenviar corrige. */
  @IsString()
  @IsNotEmpty()
  numero_nota!: string;

  @IsOptional()
  @IsString()
  serie?: string;

  /** Data em que a devolução deu entrada no ERP. É o mês dela que sofre o desconto. */
  @IsDateString()
  data!: string;

  /** Valor devolvido (total da nota de devolução). */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  valor!: number;

  @IsOptional()
  @IsString()
  pedido_codigo?: string;

  @IsOptional()
  @IsString()
  funcionario_codigo?: string;

  @IsOptional()
  @IsString()
  cliente_codigo?: string;

  /** Número da nota de venda referenciada (informativo). */
  @IsOptional()
  @IsString()
  nota_venda_numero?: string;

  /** true = a devolução foi cancelada/estornada no ERP e deixa de descontar. */
  @IsOptional()
  @IsBoolean()
  cancelada?: boolean;
}
