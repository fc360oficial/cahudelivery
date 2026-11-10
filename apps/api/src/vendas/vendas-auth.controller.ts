import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import type { Request } from 'express';
import { ipDaRequisicao } from '../auth/limite-auth.service';
import { VendasAuthService } from './vendas-auth.service';

class LoginVendedorDto {
  @IsString() @IsNotEmpty() login!: string;
  @IsString() @IsNotEmpty() senha!: string;
}

class RefreshVendedorDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

@Controller('vendas')
export class VendasAuthController {
  constructor(private readonly auth: VendasAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Req() req: Request, @Body() dto: LoginVendedorDto) {
    return this.auth.login(dto.login, dto.senha, ipDaRequisicao(req));
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshVendedorDto) {
    return this.auth.refresh(dto.refreshToken);
  }
}
