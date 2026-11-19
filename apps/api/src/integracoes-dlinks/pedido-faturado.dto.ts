import { Transform, Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateNested,
} from 'class-validator';

const STATUS = ['ABERTO', 'EM_FATURAMENTO', 'FATURADO', 'CANCELADO'] as const;

/**
 * O Dlinks monta o mesmo corpo para todo status e, enquanto a NF-e não foi
 * emitida (pedido cancelado antes de faturar, por exemplo), manda o bloco
 * vazio: `"nota_fiscal": {}`. Bloco sem nenhum campo preenchido vale como
 * "sem nota". Bloco preenchido pela metade continua sendo recusado.
 */
export function notaVazia(nota: unknown): boolean {
  if (nota === null || nota === undefined) return true;
  if (typeof nota !== 'object' || Array.isArray(nota)) return false;
  return Object.values(nota as Record<string, unknown>).every(
    (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === ''),
  );
}

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
  @Transform(({ value }) => (notaVazia(value) ? undefined : value))
  nota_fiscal?: NotaFiscalDto;
}
