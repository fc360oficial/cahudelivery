import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested,
} from 'class-validator';

const STATUS = ['ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO'] as const;

export class ItemFaturadoDto {
  @IsString()
  produto_codigo!: string;

  @IsNumber()
  quantidade!: number;

  @IsNumber()
  valor_unitario!: number;
}

export class ValoresFaturadoDto {
  @IsNumber()
  subtotal!: number;

  @IsOptional()
  @IsNumber()
  desconto?: number;

  @IsNumber()
  total!: number;
}

/**
 * NF-e que o Dlinks manda junto do faturamento (desde 22/09/2026).
 * `numero` e `serie` ficam como texto de propósito: a série pode ter zero à
 * esquerda e nada aqui é usado em conta.
 */
export class NotaFiscalDto {
  @Matches(/^\d{44}$/, { message: 'chave da NF-e deve ter 44 dígitos' })
  chave!: string;

  @IsString()
  numero!: string;

  @IsString()
  serie!: string;

  @IsOptional()
  @IsDateString()
  emitida_em?: string;

  @IsString()
  @MaxLength(2_000_000, { message: 'xml_base64 excede o tamanho máximo permitido' })
  xml_base64!: string;
}

export class PedidoFaturadoDto {
  @IsString()
  pedido_codigo!: string;

  @IsIn(STATUS)
  status!: (typeof STATUS)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => ValoresFaturadoDto)
  valores?: ValoresFaturadoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemFaturadoDto)
  itens?: ItemFaturadoDto[];

  // Sem este campo declarado, o `whitelist: true` do ValidationPipe
  // (main.ts) descarta o bloco inteiro em silêncio — foi a causa da NF-e
  // não aparecer no app em 22/09/2026.
  @IsOptional()
  @ValidateNested()
  @Type(() => NotaFiscalDto)
  nota_fiscal?: NotaFiscalDto;
}
