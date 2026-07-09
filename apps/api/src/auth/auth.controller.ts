import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class RegistrarDto {
  @IsIn(['CPF', 'CNPJ']) tipo!: 'CPF' | 'CNPJ';
  @IsNotEmpty() documento!: string;
  @IsNotEmpty() nomeFantasia!: string;
  @IsOptional() @IsString() razaoSocial?: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telefone?: string;
  @MinLength(6) senha!: string;
}

class LoginDto {
  @IsNotEmpty() identificador!: string; // e-mail ou documento
  @IsNotEmpty() senha!: string;
}

class RefreshDto {
  @IsNotEmpty() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('registrar')
  registrar(@Body() dto: RegistrarDto) {
    return this.auth.registrar(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.identificador, dto.senha);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}
