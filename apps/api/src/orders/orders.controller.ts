import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard, OptionalAuthGuard, ClienteLogado } from '../auth/jwt.guard';
import { DonoCarrinho, OrdersService } from './orders.service';
import { origemDoCanal } from './origem-pedido';

type ReqCliente = Request & { cliente: ClienteLogado };
type ReqClienteOpt = Request & { cliente?: ClienteLogado };

class ItemDto {
  @IsUUID() produtoId!: string;
  @Min(0) quantidade!: number;
}

class CriarPedidoDto {
  @IsOptional() @IsUUID() enderecoId?: string;
  @IsIn(['boleto', 'pix', 'cartao']) formaPagamento!: 'boleto' | 'pix' | 'cartao';
  @IsOptional() @IsIn(['entrega', 'retirada']) tipoEntrega?: 'entrega' | 'retirada';
  @IsOptional() @IsString() observacoes?: string;
  @IsOptional() @IsString() condicaoPagamento?: string;
  @IsOptional() @IsBoolean() usarSaldo?: boolean;
}

/** Dados do aparelho pro 3DS (tela, idioma, fuso). O IP vem da requisição. */
class DispositivoDto {
  @IsOptional() @IsInt() @Min(1) @Max(48) profundidadeCor?: number;
  @IsInt() @Min(1) @Max(100000) altura!: number;
  @IsInt() @Min(1) @Max(100000) largura!: number;
  @IsOptional() @IsString() @Length(1, 10) idioma?: string;
  @IsInt() @Min(-14) @Max(14) fusoHoras!: number;
  @IsOptional() @IsString() @Length(1, 255) userAgent?: string;
}

/** Dados do cartão só transitam até o provedor: nunca gravados, nunca logados. */
class PagarCartaoDto {
  @Matches(/^\d{13,19}$/, { message: 'Número do cartão inválido' }) numero!: string;
  @IsString() @Length(2, 30) nome!: string;
  @IsInt() @Min(1) @Max(12) validadeMes!: number;
  @IsInt() @Min(2020) @Max(2099) validadeAno!: number;
  @Matches(/^\d{3,4}$/, { message: 'Código de segurança inválido' }) cvv!: string;
  @IsOptional() @ValidateNested() @Type(() => DispositivoDto) dispositivo?: DispositivoDto;
}

/**
 * IPv4 do cliente atrás do Caddy (X-Forwarded-For, primeiro da lista). A Rede
 * só aceita IPv4 no 3DS; IPv6 sem IPv4 mapeado vira null e o serviço decide.
 */
export function ipv4DoCliente(req: Request): string | null {
  const xff = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  for (const bruto of [xff, req.socket?.remoteAddress ?? '']) {
    const ip = bruto.replace(/^::ffff:/, '');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  }
  return null;
}

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  private dono(req: ReqClienteOpt, deviceId?: string): DonoCarrinho {
    if (req.cliente) return { clienteId: req.cliente.clienteId };
    if (deviceId) return { deviceId };
    throw new BadRequestException('Envie o header X-Device-Id ou autentique-se');
  }

  @Get('carrinho')
  @UseGuards(OptionalAuthGuard)
  carrinho(@Req() req: ReqClienteOpt, @Headers('x-device-id') deviceId?: string) {
    return this.orders.carrinho(this.dono(req, deviceId));
  }

  @Put('carrinho/itens')
  @UseGuards(OptionalAuthGuard)
  upsertItem(@Req() req: ReqClienteOpt, @Headers('x-device-id') deviceId: string | undefined, @Body() dto: ItemDto) {
    return this.orders.upsertItem(this.dono(req, deviceId), dto.produtoId, dto.quantidade);
  }

  @Delete('carrinho/itens/:produtoId')
  @UseGuards(OptionalAuthGuard)
  remover(
    @Req() req: ReqClienteOpt,
    @Headers('x-device-id') deviceId: string | undefined,
    @Param('produtoId', ParseUUIDPipe) produtoId: string,
  ) {
    return this.orders.removerItem(this.dono(req, deviceId), produtoId);
  }

  @Post('pedidos')
  @UseGuards(JwtAuthGuard)
  criar(@Req() req: ReqCliente, @Body() dto: CriarPedidoDto, @Headers('x-canal') canal?: string) {
    return this.orders.criarPedido(
      req.cliente.clienteId,
      dto,
      {
        ip: ipv4DoCliente(req) ?? req.ip ?? null,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 255) || null,
      },
      origemDoCanal(canal),
    );
  }

  @Get('pedidos')
  @UseGuards(JwtAuthGuard)
  listar(@Req() req: ReqCliente, @Query('pagina') pagina = '1') {
    return this.orders.listar(req.cliente.clienteId, Math.max(1, Number(pagina) || 1));
  }

  @Get('pedidos/notas')
  @UseGuards(JwtAuthGuard)
  notas(@Req() req: ReqCliente, @Query('pagina') pagina = '1') {
    return this.orders.notas(req.cliente.clienteId, Math.max(1, Number(pagina) || 1));
  }

  @Get('pedidos/:id')
  @UseGuards(JwtAuthGuard)
  detalhe(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detalhe(req.cliente.clienteId, id);
  }

  @Post('pedidos/:id/repetir')
  @UseGuards(JwtAuthGuard)
  repetir(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.repetir(req.cliente.clienteId, id);
  }

  @Post('pedidos/:id/pagar-cartao')
  @UseGuards(JwtAuthGuard)
  pagarCartao(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PagarCartaoDto) {
    return this.orders.pagarCartao(
      req.cliente.clienteId,
      id,
      {
        numero: dto.numero,
        nome: dto.nome,
        validadeMes: dto.validadeMes,
        validadeAno: dto.validadeAno,
        cvv: dto.cvv,
      },
      {
        ip: ipv4DoCliente(req),
        // App nativo manda o user agent do WebView em que o desafio vai abrir; no
        // navegador (app web) o header da própria requisição já é o navegador.
        userAgent: dto.dispositivo?.userAgent ?? String(req.headers['user-agent'] ?? ''),
        dispositivo: dto.dispositivo,
      },
    );
  }

  /** Depois do desafio 3DS: consulta a Rede e devolve o status atual do pagamento. */
  @Post('pedidos/:id/pagar-cartao/confirmar')
  @UseGuards(JwtAuthGuard)
  confirmarCartao(@Req() req: ReqCliente, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.confirmarCartao(req.cliente.clienteId, id);
  }
}
