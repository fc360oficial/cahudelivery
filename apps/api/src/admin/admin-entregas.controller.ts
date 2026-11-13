import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { memoryStorage } from 'multer';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { ehProvedorCartao } from '../pagamentos/provedor-pagamento';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard, AdminLogado } from './admin.guard';

type ReqAdmin = Request & { admin: AdminLogado };

/**
 * Fotos do comprovante de entrega têm nome e documento de quem recebeu: ficam
 * FORA de uploads/ (que é público) e só saem por rota autenticada da retaguarda.
 */
export const PASTA_PRIVADA = join(process.cwd(), 'uploads-privado');

const EXTENSOES = ['.png', '.jpg', '.jpeg', '.webp', '.heic'];

class EntregaDto {
  @IsString() @Length(2, 120) recebedorNome!: string;
  @IsOptional() @IsString() @Length(0, 30) recebedorDocumento?: string;
  @IsOptional() @IsString() @Length(0, 500) observacao?: string;
  @IsOptional() @IsDateString() entregueEm?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
}

class EstornoDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) valor?: number;
  @IsString() @Length(3, 200) motivo!: string;
}

class ReservaDto {
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01) valor?: number;
  @IsOptional() @IsString() @Length(0, 200) motivo?: string;
}

class DevolucaoPixDto {
  @Type(() => Number) @IsNumber() @Min(0.01) valor!: number;
  @IsString() @Length(3, 200) motivo!: string;
}

@Controller('admin/pedidos/:id')
@UseGuards(AdminGuard)
export class AdminEntregasController {
  private readonly log = new Logger('AdminEntregas');

  constructor(
    private readonly pagamentos: PagamentosService,
    private readonly provedores: ProvedoresService,
  ) {}

  /**
   * Comprovante de entrega: quem recebeu, documento, foto do canhoto assinado
   * (obrigatória) e foto da entrega (opcional), hora e GPS do celular. Marca o
   * pedido como ENTREGUE. Refazer substitui o registro anterior (fica na auditoria).
   */
  @Post('entrega')
  @UseInterceptors(
    FileFieldsInterceptor([{ name: 'canhoto', maxCount: 1 }, { name: 'foto', maxCount: 1 }], {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const ok = file.mimetype.startsWith('image/');
        cb(ok ? null : new BadRequestException('Envie fotos (JPG, PNG, WEBP ou HEIC) de até 10 MB'), ok);
      },
    }),
  )
  async registrarEntrega(
    @Req() req: ReqAdmin,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EntregaDto,
    @UploadedFiles() arquivos: { canhoto?: Express.Multer.File[]; foto?: Express.Multer.File[] },
  ) {
    const { pool, tenant } = tenantCtx();
    const ped = await pool.query(`select status from pedidos where id = $1 and origem in ('app_cliente','site')`, [id]);
    if (!ped.rows[0]) throw new NotFoundException('Pedido não encontrado');
    if (ped.rows[0].status === 'CANCELADO' || ped.rows[0].status === 'AGUARDANDO_PAGAMENTO' || ped.rows[0].status === 'AGUARDANDO_VENDEDOR') {
      throw new BadRequestException('Pedido cancelado, sem pagamento ou retido não pode ser marcado como entregue');
    }
    const anterior = await pool.query(`select foto_canhoto, foto_entrega from pedido_entregas where pedido_id = $1`, [id]);
    const canhoto = arquivos?.canhoto?.[0];
    if (!canhoto && !anterior.rows[0]?.foto_canhoto) {
      throw new BadRequestException('A foto do canhoto assinado é obrigatória');
    }
    const pasta = join(PASTA_PRIVADA, tenant.slug.toLowerCase(), 'entregas');
    if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
    const gravar = (f: Express.Multer.File | undefined, tipo: string) => {
      if (!f) return null;
      const ext = EXTENSOES.includes(extname(f.originalname).toLowerCase()) ? extname(f.originalname).toLowerCase() : '.jpg';
      const nome = `${id}-${tipo}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}${ext}`;
      const tmp = join(pasta, `${nome}.tmp`);
      writeFileSync(tmp, f.buffer);
      renameSync(tmp, join(pasta, nome));
      return nome;
    };
    const fotoCanhoto = gravar(canhoto, 'canhoto') ?? anterior.rows[0]?.foto_canhoto;
    const fotoEntrega = gravar(arquivos?.foto?.[0], 'foto') ?? anterior.rows[0]?.foto_entrega ?? null;
    const entregueEm = dto.entregueEm ? new Date(dto.entregueEm) : new Date();

    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into pedido_entregas (pedido_id, recebedor_nome, recebedor_documento, foto_canhoto, foto_entrega,
                                      latitude, longitude, observacao, entregue_em, registrado_por)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (pedido_id) do update set
           recebedor_nome = excluded.recebedor_nome, recebedor_documento = excluded.recebedor_documento,
           foto_canhoto = excluded.foto_canhoto, foto_entrega = excluded.foto_entrega,
           latitude = excluded.latitude, longitude = excluded.longitude, observacao = excluded.observacao,
           entregue_em = excluded.entregue_em, registrado_por = excluded.registrado_por, criado_em = now()`,
        [id, dto.recebedorNome.trim(), dto.recebedorDocumento?.trim() || null, fotoCanhoto, fotoEntrega,
         dto.latitude ?? null, dto.longitude ?? null, dto.observacao?.trim() || null, entregueEm, req.admin.usuarioId],
      );
      const up = await client.query(`update pedidos set status = 'ENTREGUE' where id = $1 and status <> 'ENTREGUE'`, [id]);
      await client.query(
        `insert into pedido_eventos (pedido_id, status, detalhe, origem) values ($1,'ENTREGUE',$2,'retaguarda')`,
        [id, `${up.rowCount ? 'Entregue' : 'Comprovante de entrega atualizado'} — recebido por ${dto.recebedorNome.trim()}`],
      );
      await client.query(
        `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'registrar_entrega','pedido',$2,$3)`,
        [req.admin.usuarioId, id, JSON.stringify({ ...dto, fotoCanhoto, fotoEntrega, anterior: anterior.rows[0] ?? null })],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  /** Foto do comprovante (canhoto | foto), só pra retaguarda logada. */
  @Get('entrega/:tipo')
  async fotoEntrega(@Param('id', ParseUUIDPipe) id: string, @Param('tipo') tipo: string, @Res() res: Response) {
    const { pool, tenant } = tenantCtx();
    if (tipo !== 'canhoto' && tipo !== 'foto') throw new NotFoundException();
    const { rows } = await pool.query(`select foto_canhoto, foto_entrega from pedido_entregas where pedido_id = $1 and pedido_id in (select id from pedidos where origem in ('app_cliente','site'))`, [id]);
    const nome: string | null = tipo === 'canhoto' ? rows[0]?.foto_canhoto : rows[0]?.foto_entrega;
    // Nome vem do nosso banco, mas confere o formato antes de montar caminho de disco.
    if (!nome || !/^[0-9a-f-]+-(canhoto|foto)-[a-z0-9]+-[0-9a-f]+\.[a-z]+$/.test(nome)) throw new NotFoundException();
    const caminho = join(PASTA_PRIVADA, tenant.slug.toLowerCase(), 'entregas', nome);
    if (!existsSync(caminho)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(caminho);
  }

  /**
   * Estorno do cartão pela retaguarda (só papel admin). Sem valor = devolve tudo
   * o que ainda não foi estornado; com valor = parcial (ex.: faturou menos que o pago).
   */
  @Post('estorno')
  async estornar(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EstornoDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores podem estornar');
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `select id, provedor from pagamentos where pedido_id = $1 and metodo = 'cartao' and status in ('pago','estorno_solicitado') and pedido_id in (select id from pedidos where origem in ('app_cliente','site'))
        order by criado_em desc limit 1`,
      [id],
    );
    if (!rows[0]) throw new BadRequestException('Pedido sem pagamento de cartão aprovado');
    const pt = await this.provedores.obterPorNome(tenant.slug, rows[0].provedor);
    if (!pt || !ehProvedorCartao(pt.provedor)) throw new BadRequestException('Provedor do cartão indisponível');
    let r: Awaited<ReturnType<PagamentosService['estornarCartao']>>;
    try {
      r = await this.pagamentos.estornarCartao(pool, pt.provedor, rows[0].id, {
        valor: dto.valor, motivo: dto.motivo.trim(), origem: 'retaguarda', usuarioAdminId: req.admin.usuarioId,
      });
    } catch (e) {
      this.log.error(`estorno do pedido ${id}: ${e}`);
      throw new BadRequestException('Não foi possível falar com a Rede agora. Tente de novo em instantes.');
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'estornar_cartao','pedido',$2,$3)`,
      [req.admin.usuarioId, id, JSON.stringify({ ...dto, resultado: r })],
    );
    if (r.status === 'falhou' || r.status === 'nada_a_estornar') throw new BadRequestException(r.mensagem);
    if (r.status === 'processando') throw new BadRequestException('Já existe um estorno em andamento para este pedido');
    return r;
  }

  /**
   * Pré-autorização: cobra a reserva agora (sem esperar o ERP). Sem valor = valor
   * da NF-e, ou o reservado se ainda não há nota. Só admin.
   */
  @Post('cobrar-reserva')
  async cobrarReserva(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReservaDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const { pagamentoId, provedor } = await this.reservaDoPedido(id);
    const r = await this.pagamentos.cobrarReserva(pool, provedor, pagamentoId, {
      valor: dto.valor, motivo: dto.motivo?.trim() || 'cobrança manual pela retaguarda', origem: 'retaguarda', usuarioAdminId: req.admin.usuarioId,
    });
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'cobrar_reserva','pedido',$2,$3)`,
      [req.admin.usuarioId, id, JSON.stringify({ ...dto, resultado: r })],
    );
    if (r.status !== 'cobrado') throw new BadRequestException(r.mensagem);
    return r;
  }

  /** Pré-autorização: libera a reserva (nada é cobrado). Só admin. */
  @Post('liberar-reserva')
  async liberarReserva(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReservaDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores');
    const { pool } = tenantCtx();
    const { pagamentoId, provedor } = await this.reservaDoPedido(id);
    const r = await this.pagamentos.liberarReserva(pool, provedor, pagamentoId, {
      motivo: dto.motivo?.trim() || 'liberada pela retaguarda', origem: 'retaguarda', usuarioAdminId: req.admin.usuarioId,
    });
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'liberar_reserva','pedido',$2,$3)`,
      [req.admin.usuarioId, id, JSON.stringify({ ...dto, resultado: r })],
    );
    if (r.status !== 'liberado') throw new BadRequestException(r.mensagem);
    return r;
  }

  private async reservaDoPedido(pedidoId: string) {
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `select id, provedor from pagamentos where pedido_id = $1 and status = 'autorizado' and pedido_id in (select id from pedidos where origem in ('app_cliente','site')) order by criado_em desc limit 1`,
      [pedidoId],
    );
    if (!rows[0]) throw new BadRequestException('Pedido sem reserva de cartão em aberto');
    const pt = await this.provedores.obterPorNome(tenant.slug, rows[0].provedor);
    if (!pt || !ehProvedorCartao(pt.provedor)) throw new BadRequestException('Provedor do cartão indisponível');
    return { pagamentoId: rows[0].id as string, provedor: pt.provedor };
  }

  /**
   * Cliente preferiu o dinheiro ao crédito: a distribuidora faz a devolução PIX
   * pelo Itaú e registra aqui (tira o valor da carteira do cliente). Só admin.
   */
  @Post('devolucao-pix')
  async devolucaoPix(@Req() req: ReqAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DevolucaoPixDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores podem registrar devolução');
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select id from pagamentos where pedido_id = $1 and metodo = 'pix' and status in ('pago','creditado') and pedido_id in (select id from pedidos where origem in ('app_cliente','site'))
        order by criado_em desc limit 1`,
      [id],
    );
    if (!rows[0]) throw new BadRequestException('Pedido sem PIX creditado na carteira');
    let r: { devolvido: number };
    try {
      r = await this.pagamentos.registrarDevolucaoPix(pool, rows[0].id, {
        valor: dto.valor, motivo: dto.motivo.trim(), usuarioAdminId: req.admin.usuarioId,
      });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'devolver_pix','pedido',$2,$3)`,
      [req.admin.usuarioId, id, JSON.stringify(dto)],
    );
    return r;
  }

  /**
   * Dossiê pra contestar chargeback: tudo que prova a venda e a entrega num
   * lugar só (a retaguarda monta a página de impressão / PDF).
   */
  @Get('dossie')
  async dossie(@Param('id', ParseUUIDPipe) id: string) {
    const { pool, tenant } = tenantCtx();
    const { rows } = await pool.query(
      `select p.id, p.numero, p.status, p.criado_em, p.total, p.subtotal, p.forma_pagamento, p.tipo_entrega,
              p.endereco_snapshot_json, p.aceite_json, p.observacoes,
              c.razao_social, c.nome_fantasia, c.documento, c.email, c.telefone, c.criado_em as cliente_desde,
              (select count(*)::int from pedidos x where x.cliente_id = c.id and x.origem in ('app_cliente','site') and x.status in ('FATURADO','ENTREGUE') and x.id <> p.id) as pedidos_anteriores,
              (select json_agg(json_build_object('descricao', i.descricao_snapshot, 'quantidade', i.quantidade,
                  'precoUnit', i.preco_unit, 'total', i.total)) from pedido_itens i where i.pedido_id = p.id) as itens,
              (select json_agg(json_build_object('status', e.status, 'detalhe', e.detalhe, 'origem', e.origem, 'em', e.criado_em)
                  order by e.criado_em) from pedido_eventos e where e.pedido_id = p.id) as eventos,
              (select to_jsonb(n) - 'xml' from pedido_notas n where n.pedido_id = p.id) as nota,
              (select f.total from pedido_faturamentos f where f.pedido_id = p.id) as total_faturado,
              (select to_jsonb(en) from pedido_entregas en where en.pedido_id = p.id) as entrega,
              (select json_build_object('id', g.id, 'metodo', g.metodo, 'status', g.status, 'valor', g.valor,
                  'valorPago', g.valor_pago, 'pagoEm', g.pago_em, 'ref', g.provedor_ref, 'tid', g.provedor_tid,
                  'autenticacao3ds', g.autenticacao_3ds,
                  'nsu', g.payload_json->>'nsu',
                  'autorizacao', coalesce(g.payload_json->>'authorizationCode', g.payload_json->'brand'->>'authorizationCode',
                                          g.payload_json->'authorization'->>'authorizationCode'),
                  'bin', coalesce(g.payload_json->>'cardBin', g.payload_json->'authorization'->>'cardBin'),
                  'final', coalesce(g.payload_json->>'last4', g.payload_json->'authorization'->>'last4'),
                  'bandeira', coalesce(g.payload_json->'brand'->>'name', g.payload_json->'authorization'->'brand'->>'name'))
                 from pagamentos g where g.pedido_id = p.id order by g.criado_em desc limit 1) as pagamento,
              (select json_agg(json_build_object('valor', e.valor, 'destino', e.destino, 'status', e.status, 'codigo', e.codigo,
                  'mensagem', e.mensagem, 'motivo', e.motivo, 'em', e.criado_em) order by e.criado_em)
                 from pagamento_estornos e join pagamentos g on g.id = e.pagamento_id where g.pedido_id = p.id) as estornos
         from pedidos p join clientes c on c.id = p.cliente_id where p.id = $1 and p.origem in ('app_cliente','site')`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Pedido não encontrado');
    return { distribuidora: tenant.nomeFantasia, geradoEm: new Date().toISOString(), ...rows[0] };
  }
}
