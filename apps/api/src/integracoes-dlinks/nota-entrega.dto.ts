import { Type } from 'class-transformer';
import {
  IsDateString, IsDefined, IsIn, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateNested,
} from 'class-validator';

const TIPOS = ['entrega', 'retirada'] as const;
const STATUS = ['FATURADO', 'CANCELADO'] as const;

/** NF-e da nota de entrega. Mesmo bloco de /pedidos-faturados; o XML só pode faltar no cancelamento. */
export class NotaEntregaNfDto {
  @Matches(/^\d{44}$/, { message: 'chave da NF-e deve ter 44 dígitos' })
  chave!: string;

  @IsString()
  numero!: string;

  @IsString()
  serie!: string;

  @IsOptional()
  @IsDateString()
  emitida_em?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000_000, { message: 'xml_base64 excede o tamanho máximo permitido' })
  xml_base64?: string;
}

/**
 * Nota faturada de um pedido que NÃO nasceu no Fluxo Commerce (televendas, digitado direto no ERP).
 * Total, itens, volumes, peso e endereço do destinatário são lidos do XML: o ERP não precisa repetir.
 */
export class NotaEntregaDto {
  // ValidateNested sozinho deixa passar o item SEM o bloco; IsDefined + IsObject barram antes do serviço.
  @IsDefined({ message: 'nota_fiscal é obrigatória' })
  @IsObject({ message: 'nota_fiscal deve ser um objeto' })
  @ValidateNested()
  @Type(() => NotaEntregaNfDto)
  nota_fiscal!: NotaEntregaNfDto;

  /** Número do pedido no ERP (informativo, aparece nas telas). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  pedido_numero?: string;

  /** Quem digitou o pedido no ERP. Omitido = "televendas". */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  origem?: string;

  /** O mesmo código enviado em /clientes. Omitido ou desconhecido: a nota entra só com o endereço do XML. */
  @IsOptional()
  @IsString()
  cliente_codigo?: string;

  /** Omitido = "entrega". "retirada" fica guardada, mas não entra em carga. */
  @IsOptional()
  @IsIn(TIPOS)
  tipo_entrega?: (typeof TIPOS)[number];

  /** Omitido = "FATURADO". "CANCELADO" tira a nota da carga. */
  @IsOptional()
  @IsIn(STATUS)
  status?: (typeof STATUS)[number];
}
