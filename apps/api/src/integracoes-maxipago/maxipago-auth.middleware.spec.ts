import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { MaxipagoAuthMiddleware } from './maxipago-auth.middleware';
import { DatabaseService } from '../database/database.service';

const SEGREDO = 'd842046dde09a36d8d15c39dbee24713678f2191d2e981ec';
const HASH = createHash('sha256').update(SEGREDO).digest('hex');

function middlewareCom(hashCadastrado: string | null) {
  const query = jest.fn(async (_sql: string, params: unknown[]) => ({
    rows: hashCadastrado && params[0] === hashCadastrado ? [{ slug: 'cahu' }] : [],
  }));
  const db = {
    controlPool: () => ({ query }),
    getTenant: async () => ({ id: 'uuid', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' }),
    getTenantPool: async () => ({}),
  } as unknown as DatabaseService;
  return { middleware: new MaxipagoAuthMiddleware(db), query };
}

const req = (url: string) => ({ originalUrl: url }) as Request;
const res = {} as Response;

describe('MaxipagoAuthMiddleware', () => {
  it('resolve o tenant quando o segredo do caminho está cadastrado', async () => {
    const { middleware } = middlewareCom(HASH);
    const next = jest.fn();
    await middleware.use(req(`/v1/integracoes/maxipago/${SEGREDO}/webhook`), res, next);
    expect(next).toHaveBeenCalled();
  });

  it('consulta pelo sha256 do segredo, nunca pelo segredo em texto puro', async () => {
    const { middleware, query } = middlewareCom(HASH);
    await middleware.use(req(`/v1/integracoes/maxipago/${SEGREDO}/webhook`), res, jest.fn());
    expect(query.mock.calls[0][1]).toEqual([HASH]);
  });

  it('recusa segredo desconhecido', async () => {
    const { middleware } = middlewareCom(HASH);
    await expect(
      middleware.use(req('/v1/integracoes/maxipago/errado/webhook'), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('recusa quando a credencial não existe para o adaptador', async () => {
    const { middleware } = middlewareCom(null);
    await expect(
      middleware.use(req(`/v1/integracoes/maxipago/${SEGREDO}/webhook`), res, jest.fn()),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('ignora query string ao extrair o segredo', async () => {
    const { middleware } = middlewareCom(HASH);
    const next = jest.fn();
    await middleware.use(req(`/v1/integracoes/maxipago/${SEGREDO}/webhook?tentativa=2`), res, next);
    expect(next).toHaveBeenCalled();
  });
});
