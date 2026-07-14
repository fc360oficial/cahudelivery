import { Body, Controller, ForbiddenException, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';
import { tenantCtx } from '../tenancy/tenant-context';

class AdminLoginDto {
  @IsEmail() email!: string;
  @IsNotEmpty() senha!: string;
}

class BootstrapDto {
  @IsNotEmpty() nome!: string;
  @IsEmail() email!: string;
  @MinLength(8) senha!: string;
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly jwt: JwtService) {}

  /** Cria o PRIMEIRO usuário admin do tenant. Bloqueado assim que existir um. */
  @Post('bootstrap')
  async bootstrap(@Body() dto: BootstrapDto) {
    const { pool } = tenantCtx();
    const existe = await pool.query(`select 1 from usuarios_admin limit 1`);
    if (existe.rowCount) throw new ForbiddenException('Retaguarda já possui usuários');
    const { rows } = await pool.query(
      `insert into usuarios_admin (nome, email, senha_hash, papel) values ($1,$2,$3,'admin') returning id`,
      [dto.nome, dto.email.toLowerCase(), await argon2.hash(dto.senha)],
    );
    return { usuarioId: rows[0].id };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: AdminLoginDto) {
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `select id, nome, papel, senha_hash, ativo from usuarios_admin where email = $1`,
      [dto.email.toLowerCase()],
    );
    const u = rows[0];
    if (!u || !u.ativo || !(await argon2.verify(u.senha_hash, dto.senha))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const accessToken = await this.jwt.signAsync(
      { sub: u.id, slug: tenant.slug, tipo: 'admin', papel: u.papel },
      { expiresIn: '12h' },
    );
    return { accessToken, nome: u.nome, papel: u.papel, distribuidora: tenant.nomeFantasia };
  }
}
