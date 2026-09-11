import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { Type } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

/**
 * Aceita no body tanto um item único quanto uma lista de itens
 * (o Dlinks envia lista), validando cada um contra o DTO informado.
 * Sempre devolve uma lista de DTOs.
 */
@Injectable()
export class ListaOuItemPipe<T extends object> implements PipeTransform<unknown, Promise<T[]>> {
  constructor(private readonly dto: Type<T>) {}

  async transform(value: unknown): Promise<T[]> {
    const lista = Array.isArray(value) ? value : [value];
    if (lista.length === 0) {
      throw new BadRequestException('lista vazia: envie ao menos um item');
    }
    const itens = plainToInstance(this.dto, lista, { excludeExtraneousValues: false });
    const mensagens: string[] = [];
    for (let i = 0; i < itens.length; i++) {
      const erros = await validate(itens[i] as object, { whitelist: true, forbidUnknownValues: false });
      for (const m of this.mensagens(erros)) mensagens.push(`[${i}] ${m}`);
    }
    if (mensagens.length > 0) {
      throw new BadRequestException({ message: mensagens, error: 'Bad Request', statusCode: 400 });
    }
    return itens;
  }

  private mensagens(erros: ValidationError[], prefixo = ''): string[] {
    const out: string[] = [];
    for (const e of erros) {
      const nome = prefixo ? `${prefixo}.${e.property}` : e.property;
      if (e.constraints) out.push(...Object.values(e.constraints));
      if (e.children?.length) out.push(...this.mensagens(e.children, nome));
    }
    return out;
  }
}
