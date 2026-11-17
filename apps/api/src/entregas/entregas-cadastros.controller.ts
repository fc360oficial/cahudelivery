import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException,
  Param, ParseUUIDPipe, Post, Put, Req, UseGuards,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { AdminGuard, type AdminLogado } from '../admin/admin.guard';
import { tenantCtx } from '../tenancy/tenant-context';

const SITUACOES = ['ativo', 'manutencao', 'inativo'] as const;

class CaminhaoDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome do caminhão' }) @MaxLength(40)
  nome!: string;

  /** Aceita com ou sem hífen, padrão antigo (ABC1234) ou Mercosul (ABC1D23). Gravada sem hífen, em maiúsculas. */
  @IsOptional() @IsString() @Matches(/^$|^[A-Za-z]{3}-?\d[A-Za-z0-9]\d{2}$/, { message: 'Placa inválida. Exemplos: ABC1D23 ou ABC-1234' })
  placa?: string | null;

  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }) @Min(1) @Max(60000)
  capacidadeKg?: number | null;

  @IsOptional() @IsUUID()
  motoristaId?: string | null;

  @IsOptional() @IsString() @MaxLength(80)
  regiao?: string | null;

  @IsOptional() @IsIn(SITUACOES)
  situacao?: (typeof SITUACOES)[number];
}

class MotoristaDto {
  @IsString() @IsNotEmpty({ message: 'Informe o nome do motorista' }) @MaxLength(80)
  nome!: string;

  @IsOptional() @IsString() @MaxLength(20)
  telefone?: string | null;

  @IsOptional() @IsBoolean()
  ativo?: boolean;
}

class AcessoMotoristaDto {
  @IsString() @IsNotEmpty() @Matches(/^[a-zA-Z0-9._-]+$/, { message: 'Login aceita letras, números, ponto, hífen e sublinhado' })
  login!: string;

  @IsOptional() @IsString() @MinLength(8, { message: 'A senha precisa de pelo menos 8 caracteres' })
  senha?: string;

  @IsBoolean() ativo!: boolean;
}

type ReqAdmin = Request & { admin: AdminLogado };

const texto = (v: string | null | undefined) => v?.trim() || null;
/** Nome para comparar: sem espaços sobrando e sem diferença de maiúscula (com acento, o que o banco nem sempre iguala). */
export const nomeComparavel = (v: string) => v.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
export const normalizarPlaca = (v: string | null | undefined) => v?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null;

/**
 * Cadastros do Fluxo Entregas: caminhões e motoristas. Quem tem a solução "entregas" cadastra e edita;
 * definir login e senha do motorista é só de administrador (igual ao vendedor do Fluxo Vendas).
 */
@Controller('admin/entregas')
@UseGuards(AdminGuard)
export class EntregasCadastrosController {
  @Get('caminhoes')
  async caminhoes() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select c.id, c.nome, c.placa, c.capacidade_kg, c.motorista_id, m.nome as motorista_nome, c.regiao, c.situacao
         from caminhoes c left join motoristas m on m.id = c.motorista_id
        order by c.nome`,
    );
    return rows.map((c) => ({
      id: c.id, nome: c.nome, placa: c.placa, capacidadeKg: c.capacidade_kg === null ? null : Number(c.capacidade_kg),
      motoristaId: c.motorista_id, motoristaNome: c.motorista_nome, regiao: c.regiao, situacao: c.situacao,
    }));
  }

  @Post('caminhoes')
  async criarCaminhao(@Body() dto: CaminhaoDto) {
    const { pool } = tenantCtx();
    await this.recusarNomeRepetido(dto.nome, null);
    try {
      const { rows } = await pool.query(
        `insert into caminhoes (nome, placa, capacidade_kg, motorista_id, regiao, situacao)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [dto.nome.trim(), normalizarPlaca(dto.placa), dto.capacidadeKg ?? null, dto.motoristaId ?? null, texto(dto.regiao), dto.situacao ?? 'ativo'],
      );
      return { id: rows[0].id };
    } catch (e) {
      throw this.traduzir(e);
    }
  }

  @Put('caminhoes/:id')
  async atualizarCaminhao(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CaminhaoDto) {
    const { pool } = tenantCtx();
    await this.recusarNomeRepetido(dto.nome, id);
    let rowCount: number | null;
    try {
      ({ rowCount } = await pool.query(
        `update caminhoes set nome = $2, placa = $3, capacidade_kg = $4, motorista_id = $5, regiao = $6,
                              situacao = coalesce($7, situacao), atualizado_em = now()
          where id = $1`,
        [id, dto.nome.trim(), normalizarPlaca(dto.placa), dto.capacidadeKg ?? null, dto.motoristaId ?? null, texto(dto.regiao), dto.situacao ?? null],
      ));
    } catch (e) {
      throw this.traduzir(e);
    }
    if (!rowCount) throw new NotFoundException('Caminhão não encontrado');
    return { ok: true };
  }

  @Get('motoristas')
  async motoristas() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select m.id, m.nome, m.telefone, m.login, (m.senha_hash is not null) as tem_senha, m.ativo, m.ultimo_acesso_em, m.app_versao,
              (select string_agg(c.nome, ', ' order by c.nome) from caminhoes c where c.motorista_id = m.id) as caminhoes
         from motoristas m order by m.nome`,
    );
    return rows.map((m) => ({
      id: m.id, nome: m.nome, telefone: m.telefone, login: m.login, temSenha: m.tem_senha, ativo: m.ativo,
      ultimoAcessoEm: m.ultimo_acesso_em, appVersao: m.app_versao, caminhoes: m.caminhoes,
    }));
  }

  @Post('motoristas')
  async criarMotorista(@Body() dto: MotoristaDto) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `insert into motoristas (nome, telefone, ativo) values ($1,$2,coalesce($3::boolean, true)) returning id`,
      [dto.nome.trim(), texto(dto.telefone), dto.ativo ?? null],
    );
    return { id: rows[0].id };
  }

  /** Desativar o motorista encerra as sessões dele no aplicativo. */
  @Put('motoristas/:id')
  async atualizarMotorista(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MotoristaDto) {
    const { pool } = tenantCtx();
    const { rowCount } = await pool.query(
      `update motoristas set nome = $2, telefone = $3, ativo = coalesce($4::boolean, ativo) where id = $1`,
      [id, dto.nome.trim(), texto(dto.telefone), dto.ativo ?? null],
    );
    if (!rowCount) throw new NotFoundException('Motorista não encontrado');
    if (dto.ativo === false) await this.encerrarSessoes(id);
    return { ok: true };
  }

  /** Senha ausente mantém a atual. Trocar a senha ou bloquear derruba as sessões abertas do motorista. */
  @Put('motoristas/:id/acesso')
  async definirAcesso(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AcessoMotoristaDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const login = dto.login.trim().toLowerCase();
    const emUso = await pool.query(`select 1 from motoristas where login = $1 and id <> $2`, [login, id]);
    if (emUso.rowCount) throw new ConflictException('Este login já está em uso por outro motorista');
    const senhaHash = dto.senha ? await argon2.hash(dto.senha) : null;
    let rowCount: number | null;
    try {
      ({ rowCount } = await pool.query(
        `update motoristas set login = $2, senha_hash = coalesce($3, senha_hash), ativo = $4 where id = $1`,
        [id, login, senhaHash, dto.ativo],
      ));
    } catch (e) {
      // Corrida entre dois administradores: a restrição unique pegou o que a pré-checagem não viu.
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Este login já está em uso por outro motorista');
      throw e;
    }
    if (!rowCount) throw new NotFoundException('Motorista não encontrado');
    if (senhaHash || !dto.ativo) await this.encerrarSessoes(id);
    return { ok: true };
  }

  /** Apaga em vez de revogar: a renovação aceita token revogado há menos de 30 s. */
  private async encerrarSessoes(motoristaId: string) {
    const { pool } = tenantCtx();
    await pool.query(`delete from refresh_tokens where sujeito_id = $1 and sujeito = 'motorista'`, [motoristaId]);
  }

  /**
   * "CAMINHÃO 2" e "Caminhão 2" são o mesmo caminhão. A comparação é feita aqui porque o lower() do banco
   * não iguala letra acentuada em toda configuração de idioma; o índice único fica como segunda barreira.
   */
  private async recusarNomeRepetido(nome: string, idAtual: string | null) {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(`select id, nome from caminhoes`);
    const alvo = nomeComparavel(nome);
    if (rows.some((c) => c.id !== idAtual && nomeComparavel(String(c.nome)) === alvo)) {
      throw new ConflictException('Já existe um caminhão com este nome');
    }
  }

  private traduzir(e: unknown): unknown {
    const erro = e as { code?: string; constraint?: string };
    if (erro.code === '23505') {
      return new ConflictException(
        erro.constraint === 'caminhoes_placa_unica' ? 'Já existe um caminhão com esta placa' : 'Já existe um caminhão com este nome',
      );
    }
    if (erro.code === '23503') return new BadRequestException('Motorista não encontrado');
    return e;
  }
}
