import { Type } from 'class-transformer';
import { IsEmail, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

export class EnderecoDlinksDto {
  @IsString()
  logradouro!: string;

  @IsString()
  numero!: string;

  @IsOptional()
  @IsString()
  complemento?: string;

  @IsString()
  bairro!: string;

  @IsString()
  cidade!: string;

  @IsString()
  uf!: string;

  @IsString()
  cep!: string;
}

export class ClienteDto {
  @IsString()
  codigo!: string;

  @IsString()
  razao_social!: string;

  @IsString()
  cnpj_cpf!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // O Dlinks envia a chave como "Email" (maiúsculo); o contrato documenta "email".
  @IsOptional()
  @IsEmail()
  Email?: string;

  @ValidateNested()
  @Type(() => EnderecoDlinksDto)
  endereco!: EnderecoDlinksDto;

  @IsOptional()
  @IsNumber()
  limite_credito?: number;

  @IsOptional()
  @IsNumber()
  saldo_titulos_aberto?: number;

  /** Código da tabela de preço do cliente no ERP (o mesmo `id` enviado em /tabelas-de-precos). Opcional. */
  @IsOptional()
  @IsString()
  tabela_preco_id?: string;
}
