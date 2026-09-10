import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard, ClienteLogado } from './jwt.guard';

type ReqCliente = Request & { cliente: ClienteLogado };

class RegistrarDto {
  @IsIn(['CPF', 'CNPJ']) tipo!: 'CPF' | 'CNPJ';
  @IsNotEmpty() documento!: string;
  @IsNotEmpty() nomeFantasia!: string;
  @IsOptional() @IsString() razaoSocial?: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telefone?: string;
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
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('senha')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  senha(@Req() req: ReqCliente, @Body() dto: SenhaDto) {
    return this.auth.definirSenha(req.cliente.clienteId, dto.senhaAtual, dto.novaSenha);
  }
}
