import { IsNotEmpty, IsNumber, IsString, Matches, Min } from 'class-validator';

/** Faturado do mês por vendedor, como o ERP envia: um item por (vendedor, mês). */
export class VendaVendedorDto {
  @IsString()
  @IsNotEmpty()
  funcionario_codigo!: string;

  @IsString()
  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: 'ano_mes deve ser YYYY-MM' })
  ano_mes!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  valor_faturado!: number;
}
