import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsDefined, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard, ClienteLogado } from './jwt.guard';

type ReqCliente = Request & { cliente: ClienteLogado };

class EnderecoCadastroDto {
  @IsNotEmpty() cep!: string;
  @IsNotEmpty() logradouro!: string;
  @IsNotEmpty() numero!: string;
  @IsOptional() @IsString() complemento?: string;
  @IsNotEmpty() bairro!: string;
  @IsNotEmpty() cidade!: string;
  @Length(2, 2) uf!: string;
}

// Telefone e endereço são obrigatórios: alimentam o CRM da distribuidora.
class RegistrarDto {
  @IsIn(['CPF', 'CNPJ']) tipo!: 'CPF' | 'CNPJ';
  @IsNotEmpty() documento!: string;
  @IsNotEmpty() nomeFantasia!: string;
  @IsOptional() @IsString() razaoSocial?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsNotEmpty() telefone!: string;
  @IsDefined() @ValidateNested() @Type(() => EnderecoCadastroDto) endereco!: EnderecoCadastroDto;
  @IsOptional() @IsString() categoria?: string;
  @MinLength(6) senha!: string;
  @IsOptional() @IsString() codigoIndicacao?: string;
}

class LoginDto {
  @IsNotEmpty() identificador!: string; // CNPJ ou CPF (só dígitos são considerados)
  @IsNotEmpty() senha!: string;
}

class SenhaDto {
  @IsNotEmpty() senhaAtual!: string;
  @MinLength(6) novaSenha!: string;
}

class RefreshDto {
  @IsNotEmpty() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('registrar')
  registrar(@Body() dto: RegistrarDto, @Headers('x-device-id') deviceId?: string) {
    return this.auth.registrar(dto, deviceId);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Headers('x-device-id') deviceId?: string) {
    return this.auth.login(dto.identificador, dto.senha, deviceId);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto, @Headers('x-device-id') deviceId?: string) {
    return this.auth.refresh(dto.refreshToken, deviceId);
  }

  @Post('senha')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  senha(@Req() req: ReqCliente, @Body() dto: SenhaDto) {
    return this.auth.definirSenha(req.cliente.clienteId, dto.senhaAtual, dto.novaSenha);
  }
}
