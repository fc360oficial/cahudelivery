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

  @IsEmail()
  email!: string;

  @ValidateNested()
  @Type(() => EnderecoDlinksDto)
  endereco!: EnderecoDlinksDto;

  @IsOptional()
  @IsNumber()
  limite_credito?: number;

  @IsOptional()
  @IsNumber()
  saldo_titulos_aberto?: number;
}
