import { IsString } from 'class-validator';

export class CondicaoPagamentoDto {
  @IsString()
  codigo!: string;

  @IsString()
  descricao!: string;

  @IsString()
  forma_pagamento_codigo!: string;
}
