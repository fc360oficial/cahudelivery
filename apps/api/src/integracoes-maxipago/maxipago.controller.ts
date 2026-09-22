import { Controller, Headers, HttpCode, Ip, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { MaxipagoService } from './maxipago.service';

@Controller('integracoes/maxipago/:segredo')
export class MaxipagoController {
  constructor(private readonly service: MaxipagoService) {}

  /**
   * Responde 200 sempre que conseguir gravar: gateway que recebe erro fica
   * reenviando o callback. Corpo ilegível não é erro — vai cru pro banco.
   */
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: Request, @Headers('content-type') contentType: string | undefined, @Ip() ip: string) {
    return this.service.registrar(corpoComoTexto(req.body), contentType, ip);
  }
}

/** JSON já vem desserializado pelo body parser; XML e texto chegam como string. */
function corpoComoTexto(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  return JSON.stringify(body);
}
