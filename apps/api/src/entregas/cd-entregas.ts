import { BadRequestException, Body, Controller, ForbiddenException, Get, Put, Req, UseGuards } from '@nestjs/common';
import { IsLatitude, IsLongitude, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { Pool, PoolClient } from 'pg';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { geocodificar } from '../geo/geocodificador';
import { tenantCtx } from '../tenancy/tenant-context';
import type { LatLng } from './rota-otimizada';

/** Endereço do CD: ponto de partida e de volta de toda rota. Fica em configuracoes ('entregas_cd'). */
export interface CdEntregas {
  logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string;
  latitude: number; longitude: number;
  /** 'endereco' = achado pela rua; 'cep' = aproximado; 'manual' = o gerente acertou o pino no mapa. */
  precisao: 'endereco' | 'cep' | 'manual';
}

const CHAVE = 'entregas_cd';

export async function lerCd(db: Pick<Pool | PoolClient, 'query'>): Promise<CdEntregas | null> {
  const { rows } = await db.query(`select valor_json from configuracoes where chave = $1`, [CHAVE]);
  const v = rows[0]?.valor_json as CdEntregas | undefined;
  return v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude) ? v : null;
}

export const pontoDoCd = (cd: CdEntregas | null): LatLng | null => (cd ? [cd.latitude, cd.longitude] : null);

class CdDto {
  @IsString() @IsNotEmpty({ message: 'Informe a rua' }) @MaxLength(120) logradouro!: string;
  @IsString() @IsNotEmpty({ message: 'Informe o número' }) @MaxLength(20) numero!: string;
  @IsString() @IsNotEmpty({ message: 'Informe o bairro' }) @MaxLength(80) bairro!: string;
  @IsString() @IsNotEmpty({ message: 'Informe a cidade' }) @MaxLength(80) cidade!: string;
  @IsString() @Matches(/^[A-Za-z]{2}$/, { message: 'UF com 2 letras' }) uf!: string;
  @IsOptional() @IsString() @Matches(/^$|^\d{5}-?\d{3}$/, { message: 'CEP inválido' }) cep?: string;
  /** Com latitude e longitude o ponto é o que o gerente marcou no mapa; sem, o sistema procura pelo endereço. */
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
}

type ReqAdmin = Request & { admin: AdminLogado };

/**
 * O mapa nem sempre escreve a rua como o cadastro (ex.: "Antônio Luís Soares" no cadastro, "Antônio Luiz Soares"
 * no OpenStreetMap). Tenta a grafia digitada e, se só achar o bairro, as variações comuns (s/z, sem acento).
 */
export function grafiasDaRua(rua: string): string[] {
  const semAcento = rua.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const trocas = [
    rua.replace(/Lu[ií]s\b/gi, 'Luiz'), rua.replace(/Luiz\b/gi, 'Luís'),
    rua.replace(/Lu[ií]s\b/gi, 'Luiz').replace(/Ant[oô]nio/gi, 'Antonio'),
    rua.replace(/Sous?a\b/gi, (m) => (m.toLowerCase() === 'sousa' ? 'Souza' : 'Sousa')),
    semAcento,
  ];
  return [...new Set([rua, ...trocas])];
}

async function acharNoMapa(end: { logradouro: string; numero: string; bairro: string; cidade: string; uf: string; cep: string }) {
  let aproximado: Awaited<ReturnType<typeof geocodificar>> = null;
  for (const rua of grafiasDaRua(end.logradouro)) {
    const c = await geocodificar({ ...end, logradouro: rua });
    if (c?.precisao === 'endereco') return c;
    aproximado ??= c;
  }
  return aproximado;
}

@Controller('admin/entregas/cd')
@UseGuards(AdminGuard)
export class EntregasCdController {
  @Get()
  async ler() {
    const { pool } = tenantCtx();
    return { cd: await lerCd(pool) };
  }

  @Put()
  async salvar(@Req() req: ReqAdmin, @Body() dto: CdDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const end = {
      logradouro: dto.logradouro.trim(), numero: dto.numero.trim(), bairro: dto.bairro.trim(), cidade: dto.cidade.trim(),
      uf: dto.uf.trim().toUpperCase(), cep: (dto.cep ?? '').replace(/\D/g, ''),
    };
    let ponto: { latitude: number; longitude: number; precisao: CdEntregas['precisao'] };
    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      ponto = { latitude: Number(dto.latitude), longitude: Number(dto.longitude), precisao: 'manual' };
    } else {
      const c = await acharNoMapa(end);
      if (!c) throw new BadRequestException('Não achei esse endereço no mapa. Confira a rua e o número, ou marque o ponto no mapa.');
      ponto = { latitude: c.lat, longitude: c.lng, precisao: c.precisao };
    }
    const cd: CdEntregas = { ...end, ...ponto };
    await pool.query(
      `insert into configuracoes (chave, valor_json) values ($1, $2) on conflict (chave) do update set valor_json = excluded.valor_json`,
      [CHAVE, JSON.stringify(cd)],
    );
    return { cd };
  }
}
