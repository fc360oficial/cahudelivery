import { Controller, INestApplication, MiddlewareConsumer, Module, NestMiddleware, NestModule } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Pool } from 'pg';
import { runComTenant } from '../tenancy/tenant-context';
import { OrdersService } from '../orders/orders.service';
import { OrdersController } from '../orders/orders.controller';
import { codigoPedido3ds, destinoRetornoSite, pedidoDoCodigo3ds, TresDsController, urlsRetorno3ds } from './tres-ds.controller';

// Cópia literal da página de hoje (antes do retorno pro site): a resposta sem canal site tem que continuar byte a byte igual.
const PAGINA_OK = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compra confirmada no banco</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;text-align:center;background:#fff;color:#1a1a1a}h1{font-size:20px}p{color:#555;line-height:1.5}</style></head>
<body><h1>Compra confirmada no banco</h1><p>Pode voltar ao aplicativo: o pagamento aparece no pedido em instantes.</p></body></html>`;
const PAGINA_FALHOU = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>O banco não confirmou a compra</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:32px 20px;text-align:center;background:#fff;color:#1a1a1a}h1{font-size:20px}p{color:#555;line-height:1.5}</style></head>
<body><h1>O banco não confirmou a compra</h1><p>Volte ao aplicativo e tente de novo, use outro cartão ou pague com PIX.</p></body></html>`;

const PEDIDO = '0b6f3a52-9c1d-4e7a-8f20-5d4c3b2a1908';
const CODIGO = codigoPedido3ds(PEDIDO);
const PUBLIC_URL_PRODUCAO = 'https://cahudelivery.duckdns.org';

/** Mesmo arranjo do AppModule: o middleware de tenant não pode pegar a rota do 3DS. */
class ExigeTenant implements NestMiddleware {
  use(req: { headers: Record<string, unknown> }, res: { status(n: number): { end(): void } }, next: () => void) {
    if (!req.headers['x-tenant']) return res.status(418).end();
    next();
  }
}
@Controller('outra')
class OutraController {}
@Module({ controllers: [TresDsController, OutraController] })
class ModuloTeste implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ExigeTenant).exclude('pagamentos/3ds/(.*)').forRoutes('*');
  }
}

let app: INestApplication;
const env = { ...process.env };
beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [ModuloTeste] }).compile();
  app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('v1');
  await app.init();
});
afterAll(async () => {
  await app.close();
});
afterEach(() => {
  process.env = { ...env };
});
const http = () => request(app.getHttpServer());

describe('GET /v1/pagamentos/3ds/:tenant/:resultado — sem canal site, igual a hoje', () => {
  it('ok e falhou devolvem a página de hoje, byte a byte, com os mesmos cabeçalhos', async () => {
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br';
    for (const [res, pagina] of [['ok', PAGINA_OK], ['falhou', PAGINA_FALHOU], ['qualquer', PAGINA_FALHOU]]) {
      const r = await http().get(`/v1/pagamentos/3ds/cahu/${res}`);
      expect(r.status).toBe(200);
      expect(r.text).toBe(pagina);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.headers['cache-control']).toBe('no-store');
    }
  });

  it('parâmetros na query não mudam nada (canal=site, canal=outro, pedido=//evil.com, pedido=../x)', async () => {
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br';
    for (const q of [`canal=site&pedido=${PEDIDO}`, 'canal=outro', 'canal=site&pedido=//evil.com', 'canal=site&pedido=../x']) {
      const r = await http().get(`/v1/pagamentos/3ds/cahu/ok?${q}`);
      expect(r.status).toBe(200);
      expect(r.text).toBe(PAGINA_OK);
    }
  });

  it('POST (o banco pode voltar por POST) também igual', async () => {
    const r = await http().post('/v1/pagamentos/3ds/cahu/ok').send('x=1');
    expect(r.status).toBe(200);
    expect(r.text).toBe(PAGINA_OK);
  });
});

describe('GET /v1/pagamentos/3ds/:tenant/:resultado/:pedido — retorno pro site', () => {
  it('com SITE_URL do tenant: 302 pra página do pedido no site', async () => {
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br/';
    const ok = await http().get(`/v1/pagamentos/3ds/cahu/ok/${CODIGO}`);
    expect(ok.status).toBe(302);
    expect(ok.headers.location).toBe(`https://site.cahu.com.br/conta/pedidos/${PEDIDO}?pagamento=ok`);
    expect(ok.headers['cache-control']).toBe('no-store');
    const falhou = await http().post(`/v1/pagamentos/3ds/cahu/falhou/${CODIGO}`).send('x=1');
    expect(falhou.status).toBe(302);
    expect(falhou.headers.location).toBe(`https://site.cahu.com.br/conta/pedidos/${PEDIDO}?pagamento=falhou`);
  });

  it('o middleware de tenant continua fora da rota do 3DS (também com 3 segmentos)', async () => {
    expect((await http().get('/v1/outra')).status).toBe(418);
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br';
    expect((await http().get(`/v1/pagamentos/3ds/cahu/ok/${CODIGO}`)).status).toBe(302);
  });

  it('sem URL configurada: mostra a página de hoje', async () => {
    delete process.env.SITE_URL_CAHU;
    const r = await http().get(`/v1/pagamentos/3ds/cahu/ok/${CODIGO}`);
    expect(r.status).toBe(200);
    expect(r.text).toBe(PAGINA_OK);
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('código de pedido inválido, resultado desconhecido ou tenant sem config: página de hoje, nunca redireciona', async () => {
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br';
    const ruins = [
      `ok/${encodeURIComponent('//evil.com')}`,
      `ok/${encodeURIComponent('../x')}`,
      `ok/${encodeURIComponent(PEDIDO)}`, // uuid cru não é o código que a API gera
      'ok/evil.com',
      `ok/${CODIGO}x`,
      `ok/${CODIGO.slice(0, 21)}.`,
      `ok/${CODIGO.slice(0, 21)}${CODIGO[21] === 'A' ? 'B' : 'A'}`, // mesma sequência de bytes, forma não canônica
      `xyz/${CODIGO}`,
    ];
    for (const caminho of ruins) {
      const r = await http().get(`/v1/pagamentos/3ds/cahu/${caminho}`);
      expect([200, 404]).toContain(r.status);
      expect(r.headers.location).toBeUndefined();
    }
    const outro = await http().get(`/v1/pagamentos/3ds/outro/ok/${CODIGO}`);
    expect(outro.status).toBe(200);
    expect(outro.headers.location).toBeUndefined();
  });
});

describe('destinoRetornoSite', () => {
  it('só monta a URL com a base configurada, o uuid validado e ok/falhou', () => {
    process.env.SITE_URL_CAHU = 'https://site.cahu.com.br';
    expect(destinoRetornoSite('cahu', 'ok', CODIGO)).toBe(`https://site.cahu.com.br/conta/pedidos/${PEDIDO}?pagamento=ok`);
    expect(destinoRetornoSite('CAHU', 'falhou', CODIGO)).toBe(`https://site.cahu.com.br/conta/pedidos/${PEDIDO}?pagamento=falhou`);
    expect(destinoRetornoSite('cahu', 'outro', CODIGO)).toBeNull();
    expect(destinoRetornoSite('cahu', 'ok', '//evil.com')).toBeNull();
    expect(destinoRetornoSite('cahu', 'ok', '../x')).toBeNull();
    expect(destinoRetornoSite('ca-hu', 'ok', CODIGO)).toBeNull();
    expect(destinoRetornoSite('../x', 'ok', CODIGO)).toBeNull();
  });

  it('base mal configurada não vira redirecionamento', () => {
    for (const base of ['javascript:alert(1)', 'ftp://site', 'site.cahu.com.br', '//evil.com', 'https://site?x=1', 'https://site#x', '']) {
      process.env.SITE_URL_CAHU = base;
      expect(destinoRetornoSite('cahu', 'ok', CODIGO)).toBeNull();
    }
  });

  it('código do pedido: ida e volta exata, e só a forma canônica', () => {
    expect(CODIGO).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pedidoDoCodigo3ds(CODIGO)).toBe(PEDIDO);
    expect(pedidoDoCodigo3ds(PEDIDO)).toBeNull();
    expect(pedidoDoCodigo3ds('')).toBeNull();
    expect(pedidoDoCodigo3ds(`${CODIGO.slice(0, 21)}${CODIGO[21] === 'A' ? 'B' : 'A'}`)).toBeNull();
  });
});

describe('urlsRetorno3ds', () => {
  it('sem pedido do site: as mesmas URLs de hoje', () => {
    process.env.PUBLIC_URL = `${PUBLIC_URL_PRODUCAO}/`;
    expect(urlsRetorno3ds('CAHU')).toEqual({
      sucesso: `${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/ok`,
      falha: `${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/falhou`,
    });
    delete process.env.PUBLIC_URL;
    expect(urlsRetorno3ds('cahu')).toBeNull();
    expect(urlsRetorno3ds('cahu', PEDIDO)).toBeNull();
  });

  it('com pedido do site: código do pedido no fim, dentro do limite de 87 da Rede', () => {
    process.env.PUBLIC_URL = PUBLIC_URL_PRODUCAO;
    const u = urlsRetorno3ds('cahu', PEDIDO)!;
    expect(u).toEqual({
      sucesso: `${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/ok/${CODIGO}`,
      falha: `${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/falhou/${CODIGO}`,
    });
    expect(u.sucesso.length).toBeLessThanOrEqual(87);
    expect(u.falha.length).toBeLessThanOrEqual(87);
  });

  it('PUBLIC_URL longa demais pro retorno do site: volta às URLs do app (o pagamento não trava)', () => {
    process.env.PUBLIC_URL = 'https://um-endereco-bem-mais-comprido.exemplo.com.br';
    const u = urlsRetorno3ds('cahu', PEDIDO)!;
    expect(u.sucesso).toBe('https://um-endereco-bem-mais-comprido.exemplo.com.br/v1/pagamentos/3ds/cahu/ok');
  });
});

describe('OrdersService.pagarCartao — URL de retorno do 3DS conforme o canal', () => {
  const TENANT = { id: 'tnt-1', slug: 'cahu', nomeFantasia: 'CAHU', appNome: 'CAHU Delivery', adaptadorErp: 'dlinks' };
  const CARTAO = { numero: '5448280000000007', nome: 'JOAO', validadeMes: 12, validadeAno: 2028, cvv: '123' };
  const APARELHO = { ip: '1.2.3.4', userAgent: 'Mozilla', dispositivo: { altura: 800, largura: 400, fusoHoras: -3 } };

  async function pagar(retornoNoSite?: boolean) {
    process.env.PUBLIC_URL = PUBLIC_URL_PRODUCAO;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('from pagamentos g join pedidos p')) {
        return { rows: [{ id: 'pag-1', status: 'pendente', metodo: 'cartao', valor: '20.00', expira_em: new Date(Date.now() + 600000),
          provedor: 'erede', numero: 42, endereco_snapshot_json: { cidade: 'Recife' }, email: 'a@b.c', telefone: '81' }] };
      }
      return { rows: [] };
    });
    const pagarComCartao = jest.fn().mockResolvedValue({ status: 'pendente' });
    const obterPorNome = jest.fn().mockResolvedValue({ provedor: { nome: 'erede', metodo: 'cartao', usa3ds: true, cobrar: jest.fn() } });
    const svc = new OrdersService({} as never, { pagarComCartao } as never, { obterPorNome } as never);
    await runComTenant({ tenant: TENANT as never, pool: { query } as unknown as Pool }, () =>
      retornoNoSite === undefined
        ? svc.pagarCartao('cli-1', PEDIDO, CARTAO, APARELHO)
        : svc.pagarCartao('cli-1', PEDIDO, CARTAO, APARELHO, retornoNoSite));
    return pagarComCartao.mock.calls[0][4] as { urlSucesso: string; urlFalha: string };
  }

  it('app (sem canal): URLs de hoje', async () => {
    const ctx = await pagar();
    expect(ctx.urlSucesso).toBe(`${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/ok`);
    expect(ctx.urlFalha).toBe(`${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/falhou`);
    expect(await pagar(false)).toEqual(ctx);
  });

  it('site: URLs com o código do pedido', async () => {
    const ctx = await pagar(true);
    expect(ctx.urlSucesso).toBe(`${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/ok/${CODIGO}`);
    expect(ctx.urlFalha).toBe(`${PUBLIC_URL_PRODUCAO}/v1/pagamentos/3ds/cahu/falhou/${CODIGO}`);
  });
});

describe('OrdersController.pagarCartao — cabeçalho X-Canal', () => {
  const req = { cliente: { clienteId: 'cli-1' }, headers: {}, socket: {} } as never;
  const dto = { numero: '5448280000000007', nome: 'JOAO', validadeMes: 12, validadeAno: 2028, cvv: '123' } as never;
  it.each([
    [undefined, false],
    ['', false],
    ['outro', false],
    ['SITE', false],
    ['site', true],
  ])('X-Canal=%p => retorno no site %p', async (canal, esperado) => {
    const pagarCartao = jest.fn().mockResolvedValue({});
    const ctl = new OrdersController({ pagarCartao } as unknown as OrdersService);
    await ctl.pagarCartao(req, PEDIDO, dto, canal as string | undefined);
    expect(pagarCartao).toHaveBeenCalledWith('cli-1', PEDIDO, expect.anything(), expect.anything(), esperado);
  });
});
