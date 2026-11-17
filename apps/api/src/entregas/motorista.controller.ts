import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UploadedFile, UploadedFiles,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { MotoristaGuard, type MotoristaLogado } from './motorista-auth';
import { MOTIVOS_NAO_ENTREGA, MotoristaService, TIPOS_OCORRENCIA, type MotivoNaoEntrega, type TipoOcorrencia } from './motorista.service';

/** Fotos tiradas no celular: até 10 MB cada, só imagem. */
const OPCOES_FOTO = {
  storage: memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req: unknown, file: Express.Multer.File, cb: (e: Error | null, ok: boolean) => void) => {
    const ok = file.mimetype.startsWith('image/');
    cb(ok ? null : new BadRequestException('Envie fotos (JPG, PNG, WEBP ou HEIC) de até 10 MB'), ok);
  },
};

/** Em formulário com foto tudo chega como texto: "a,b" ou "[\"a\",\"b\"]" viram lista; número em texto vira número. */
const lista = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if (t.startsWith('[')) {
    try { return JSON.parse(t); } catch { return t; }
  }
  return t ? t.split(',').map((s) => s.trim()) : [];
};

class PontoDto {
  @IsOptional() @IsDateString() em?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) lng?: number;
}

class ParadaDto extends PontoDto {
  @Transform(lista) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID(undefined, { each: true })
  linhaIds!: string[];
}

class EntregueDto extends ParadaDto {
  @IsString() @Length(2, 120, { message: 'Informe o nome de quem recebeu' }) recebedorNome!: string;
  @IsOptional() @IsString() @MaxLength(30) recebedorDocumento?: string;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

class NaoEntregueDto extends ParadaDto {
  @IsIn(MOTIVOS_NAO_ENTREGA) motivo!: MotivoNaoEntrega;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

class OcorrenciaDto {
  @IsUUID() id!: string;
  @IsUUID() linhaId!: string;
  @IsIn(TIPOS_OCORRENCIA) tipo!: TipoOcorrencia;
  @IsOptional() @IsString() @MaxLength(60) produtoCodigo?: string;
  @IsOptional() @IsString() @MaxLength(200) produtoDescricao?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) @Max(100000) quantidade?: number;
  @IsOptional() @IsString() @MaxLength(500) observacao?: string;
  @IsOptional() @IsDateString() em?: string;
}

class PosicaoDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100000) precisaoM?: number;
  @IsDateString() em!: string;
}

class PosicoesDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PosicaoDto)
  pontos!: PosicaoDto[];
}

class MomentoDto {
  @IsOptional() @IsDateString() em?: string;
}

type ReqMotorista = Request & { motorista: MotoristaLogado };

/** API do aplicativo Fluxo Entregas (motorista). Toda ação pode ser reenviada pela fila sem sinal. */
@Controller('motorista')
@UseGuards(MotoristaGuard)
export class MotoristaController {
  constructor(private readonly servico: MotoristaService) {}

  @Get('carga')
  carga(@Req() req: ReqMotorista) {
    return this.servico.cargaAtual(req.motorista.motoristaId);
  }

  @Post('cargas/:id/iniciar')
  @HttpCode(200)
  iniciar(@Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MomentoDto) {
    return this.servico.iniciar(req.motorista.motoristaId, id, dto.em);
  }

  @Post('cargas/:id/chegada')
  @HttpCode(200)
  chegada(@Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ParadaDto) {
    return this.servico.chegada(req.motorista.motoristaId, id, dto.linhaIds, dto);
  }

  @Post('cargas/:id/entregue')
  @HttpCode(200)
  @UseInterceptors(FileFieldsInterceptor([{ name: 'assinatura', maxCount: 1 }, { name: 'mercadoria', maxCount: 1 }], OPCOES_FOTO))
  entregue(
    @Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EntregueDto,
    @UploadedFiles() fotos: { assinatura?: Express.Multer.File[]; mercadoria?: Express.Multer.File[] },
  ) {
    return this.servico.entregue(req.motorista.motoristaId, id, dto.linhaIds, dto, {
      assinatura: fotos?.assinatura?.[0], mercadoria: fotos?.mercadoria?.[0],
    });
  }

  @Post('cargas/:id/nao-entregue')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('foto', OPCOES_FOTO))
  naoEntregue(@Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NaoEntregueDto, @UploadedFile() foto?: Express.Multer.File) {
    return this.servico.naoEntregue(req.motorista.motoristaId, id, dto.linhaIds, dto, foto);
  }

  @Post('cargas/:id/ocorrencias')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('foto', OPCOES_FOTO))
  ocorrencia(@Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OcorrenciaDto, @UploadedFile() foto?: Express.Multer.File) {
    return this.servico.ocorrencia(req.motorista.motoristaId, id, dto, foto);
  }

  @Post('cargas/:id/encerrar')
  @HttpCode(200)
  encerrar(@Req() req: ReqMotorista, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MomentoDto) {
    return this.servico.encerrar(req.motorista.motoristaId, id, dto.em);
  }

  @Post('posicoes')
  @HttpCode(200)
  posicoes(@Req() req: ReqMotorista, @Body() dto: PosicoesDto) {
    return this.servico.posicoes(req.motorista.motoristaId, dto.pontos);
  }
}
