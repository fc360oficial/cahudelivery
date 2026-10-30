import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Length, Min } from 'class-validator';
import type { Request } from 'express';
import { PagamentosService } from '../pagamentos/pagamentos.service';
import { ProvedoresService } from '../pagamentos/provedores.service';
import { ProvedorCartao, ehProvedorCartao } from '../pagamentos/provedor-pagamento';
import { tenantCtx } from '../tenancy/tenant-context';
import { AdminGuard, AdminLogado } from './admin.guard';

type ReqAdmin = Request & { admin: AdminLogado };

class EstornoRedeDto {
  @Type(() => Number) @IsNumber() @Min(0.01) valor!: number;
  @IsString() @Length(3, 200) motivo!: string;
}

/**
 * Retaguarda › Cartão (Rede): consulta qualquer venda do PV por TID ou
 * referência e cancela/estorna pela API — sem entrar no portal useRede. A API
 * da Rede não lista vendas, só busca uma por vez; a lista "do app" vem do nosso banco.
 */
@Controller('admin/rede')
@UseGuards(AdminGuard)
export class AdminRedeController {
  private readonly log = new Logger('AdminRede');

  constructor(
    private readonly provedores: ProvedoresService,
    private readonly pagamentos: PagamentosService,
  ) {}

  private async provedor(): Promise<ProvedorCartao> {
    const { tenant } = tenantCtx();
    const pt = await this.provedores.obter(tenant.slug, 'cartao');
    if (!pt || !ehProvedorCartao(pt.provedor)) throw new BadRequestException('Cartão online (Rede) não está configurado');
    return pt.provedor;
  }

  /** Últimas vendas com cartão feitas pelo app (o atalho pra não precisar do TID). */
  @Get('vendas')
  async vendas() {
    const { pool } = tenantCtx();
    const { rows } = await pool.query(
      `select g.id, g.status, g.valor, g.valor_pago, g.provedor_ref, g.provedor_tid, g.criado_em, g.pago_em, g.autorizado_em,
              p.id as pedido_id, p.numero, c.nome_fantasia as cliente
         from pagamentos g join pedidos p on p.id = g.pedido_id join clientes c on c.id = p.cliente_id
        where g.metodo = 'cartao' and g.status not in ('pendente','expirado')
        order by g.criado_em desc limit 40`,
    );
    return rows;
  }

  /** Busca na Rede por TID (20 dígitos) ou referência. Diz se a venda é de um pedido do app. */
  @Get('transacao')
  async transacao(@Query('busca') busca?: string) {
    const termo = String(busca ?? '').trim();
    if (!/^[A-Za-z0-9]{4,20}$/.test(termo)) throw new BadRequestException('Informe o TID ou a referência da venda');
    const prov = await this.provedor();
    const porTid = /^\d{20}$/.test(termo);
    let t;
    try {
      t = await prov.consultarTransacao(porTid ? { tid: termo } : { ref: termo });
    } catch (e) {
      this.log.warn(`consulta ${termo}: ${e}`);
      throw new BadRequestException('Não foi possível consultar a Rede agora. Tente de novo em instantes.');
    }
    if (!t) throw new NotFoundException('Venda não encontrada na Rede');
    const { pool } = tenantCtx();
    const vinc = await pool.query(
      `select g.id as pagamento_id, g.status as pagamento_status, p.id as pedido_id, p.numero
         from pagamentos g join pedidos p on p.id = g.pedido_id
        where g.metodo = 'cartao' and (g.provedor_tid = $1 or g.provedor_ref = $2) limit 1`,
      [t.tid, t.referencia],
    );
    return { ...t, pedido: vinc.rows[0] ?? null };
  }

  /**
   * Cancela/estorna pela API. Venda de pedido do app passa pelo fluxo do pedido
   * (fica registrada nele e no status do pagamento); venda avulsa vai direto. Só admin.
   */
  @Post('transacao/:tid/estorno')
  async estornar(@Req() req: ReqAdmin, @Param('tid') tid: string, @Body() dto: EstornoRedeDto) {
    if (req.admin.papel !== 'admin') throw new ForbiddenException('Apenas administradores podem estornar');
    if (!/^\d{20}$/.test(tid)) throw new BadRequestException('TID inválido');
    const { pool } = tenantCtx();
    const prov = await this.provedor();
    const t = await prov.consultarTransacao({ tid }).catch(() => null);
    if (!t) throw new NotFoundException('Venda não encontrada na Rede');
    if (dto.valor > t.disponivelEstorno + 0.009) {
      throw new BadRequestException(`Dá pra estornar até R$ ${t.disponivelEstorno.toFixed(2)} nesta venda`);
    }
    const vinc = await pool.query(
      `select g.id, g.status from pagamentos g where g.metodo = 'cartao' and (g.provedor_tid = $1 or g.provedor_ref = $2) limit 1`,
      [t.tid, t.referencia],
    );
    const motivo = dto.motivo.trim();
    let resultado: { status: string; mensagem: string };
    if (vinc.rows[0]?.status === 'autorizado') {
      resultado = await this.pagamentos.liberarReserva(pool, prov, vinc.rows[0].id, { motivo, origem: 'retaguarda', usuarioAdminId: req.admin.usuarioId });
    } else if (vinc.rows[0] && ['pago', 'estorno_solicitado'].includes(vinc.rows[0].status)) {
      resultado = await this.pagamentos.estornarCartao(pool, prov, vinc.rows[0].id, {
        valor: dto.valor, motivo, origem: 'retaguarda', usuarioAdminId: req.admin.usuarioId,
      });
    } else {
      const r = await prov.estornar(t.tid, dto.valor);
      resultado = { status: r.status, mensagem: `${r.mensagem}${r.codigo ? ` (${r.codigo})` : ''}` };
    }
    await pool.query(
      `insert into auditoria (usuario_admin_id, acao, entidade, entidade_id, dados_json) values ($1,'estornar_rede','transacao_rede',$2,$3)`,
      [req.admin.usuarioId, t.tid, JSON.stringify({ ...dto, resultado, pedido: vinc.rows[0]?.id ?? null })],
    );
    if (!['concluido', 'solicitado', 'liberado'].includes(resultado.status)) throw new BadRequestException(resultado.mensagem);
    return resultado;
  }
}
