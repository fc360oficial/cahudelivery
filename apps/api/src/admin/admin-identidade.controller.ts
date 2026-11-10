import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString, MaxLength, ValidateIf } from 'class-validator';
import type { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard, AdminLogado } from './admin.guard';
import { opcoesUploadImagem, responderUploadImagem } from './upload-imagem';

type ReqAdmin = Request & { admin: AdminLogado };

const CHAVE = 'logo_retaguarda_url';

export class LogoDto {
  /** URL devolvida pelo upload; null remove a logo. */
  @ValidateIf((o: LogoDto) => o.url !== null)
  @IsString()
  @MaxLength(500)
  url!: string | null;
}

/** Só aceita o que o nosso upload produz: http(s) com caminho /uploads/<arquivo>. */
function urlDeUpload(valor: string): string {
  let u: URL;
  try {
    u = new URL(valor);
  } catch {
    throw new BadRequestException('Use uma imagem enviada pelo sistema');
  }
  const ok =
    (u.protocol === 'http:' || u.protocol === 'https:') &&
    /^\/uploads\/[^/]+$/.test(u.pathname) &&
    !u.pathname.includes('..');
  if (!ok) throw new BadRequestException('Use uma imagem enviada pelo sistema');
  return valor;
}

/**
 * Identidade da distribuidora na retaguarda. A logo fica em tenant_temas.config_json
 * (chave logo_retaguarda_url), separada de logo_url, que é do aplicativo do cliente.
 */
@Controller('admin/identidade')
@UseGuards(AdminGuard)
export class AdminIdentidadeController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async obter() {
    const { tenant } = tenantCtx();
    const r = await this.db
      .controlPool()
      .query(
        `select config_json->>'${CHAVE}' as logo from tenant_temas where tenant_id = $1`,
        [tenant.id],
      );
    return {
      logoUrl: (r.rows[0]?.logo as string | null | undefined) ?? null,
      distribuidora: tenant.nomeFantasia,
    };
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('arquivo', opcoesUploadImagem()))
  upload(
    @Req() req: ReqAdmin,
    @Query('tipo') tipo?: string,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    this.exigirAdmin(req);
    return responderUploadImagem(req, tipo, arquivo);
  }

  @Put('logo')
  async definirLogo(@Req() req: ReqAdmin, @Body() dto: LogoDto) {
    this.exigirAdmin(req);
    const { tenant, pool } = tenantCtx();
    const control = this.db.controlPool();
    let logoUrl: string | null = null;
    if (dto.url === null || dto.url === undefined) {
      // Remove só a chave; cria a linha vazia se ainda não existir.
      await control.query(
        `insert into tenant_temas (tenant_id) values ($1)
         on conflict (tenant_id) do update
           set config_json = tenant_temas.config_json - '${CHAVE}', atualizado_em = now()`,
        [tenant.id],
      );
    } else {
      logoUrl = urlDeUpload(dto.url);
      await control.query(
        `insert into tenant_temas (tenant_id, config_json) values ($1, $2::jsonb)
         on conflict (tenant_id) do update
           set config_json = tenant_temas.config_json || excluded.config_json, atualizado_em = now()`,
        [tenant.id, JSON.stringify({ [CHAVE]: logoUrl })],
      );
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, dados_json) values ($1,'definir_logo_retaguarda','identidade',$2)`,
      [req.admin.usuarioId, JSON.stringify({ url: logoUrl })],
    );
    return { logoUrl };
  }

  private exigirAdmin(req: ReqAdmin) {
    if (req.admin.papel !== 'admin')
      throw new ForbiddenException('Apenas administradores');
  }
}
