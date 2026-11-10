import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { runComTenant } from '../tenancy/tenant-context';
import { CatalogService } from '../catalog/catalog.service';
import { AdminGuard } from './admin.guard';
import {
  AdminIdentidadeController,
  LogoDto,
} from './admin-identidade.controller';
import { caminhoDaRequisicao, solucaoExigida } from './solucoes';

const TENANT = {
  id: 'tnt-1',
  slug: 'cahu',
  nomeFantasia: 'CAHU Distribuidora',
};
const reqAdmin = { admin: { usuarioId: 'a', papel: 'admin' } } as never;
const reqOp = { admin: { usuarioId: 'o', papel: 'operador' } } as never;
const URL_OK = 'https://api.exemplo.com/uploads/abc-123.png';

function montar(linhasControl: unknown[] = []) {
  const control = jest.fn(async () => ({ rows: linhasControl }));
  const tenantQ = jest.fn(async () => ({ rows: [] }));
  const ctl = new AdminIdentidadeController({
    controlPool: () => ({ query: control }),
  } as never);
  const rodar = <T>(fn: () => Promise<T>) =>
    runComTenant(
      { tenant: TENANT as never, pool: { query: tenantQ } as never },
      fn,
    );
  return { ctl, control, tenantQ, rodar };
}

describe('Identidade — rota isenta de solução', () => {
  it('é isenta: operador só com vendas passa no GET', async () => {
    expect(
      solucaoExigida(caminhoDaRequisicao('/v1/admin/identidade') as string),
    ).toBeNull();
    expect(
      solucaoExigida(
        caminhoDaRequisicao('/v1/admin/identidade/logo') as string,
      ),
    ).toBeNull();
    const jwt = {
      verifyAsync: jest.fn(async () => ({
        sub: 'u1',
        slug: 'cahu',
        tipo: 'admin',
      })),
    };
    const guard = new AdminGuard(jwt as never);
    const req = {
      headers: { authorization: 'Bearer x' },
      originalUrl: '/v1/admin/identidade',
      url: '/v1/admin/identidade',
    };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) };
    const query = jest.fn(async () => ({
      rows: [{ papel: 'operador', ativo: true, solucoes: ['vendas'] }],
    }));
    await expect(
      runComTenant(
        { tenant: TENANT as never, pool: { query } as never },
        async () => guard.canActivate(ctx as never),
      ),
    ).resolves.toBe(true);
  });
});

describe('GET /admin/identidade', () => {
  it('devolve a logo guardada e o nome da distribuidora', async () => {
    const { ctl, control, rodar } = montar([{ logo: URL_OK }]);
    expect(await rodar(() => ctl.obter())).toEqual({
      logoUrl: URL_OK,
      distribuidora: 'CAHU Distribuidora',
    });
    expect(String((control.mock.calls[0] as unknown[])[0])).toContain(
      'logo_retaguarda_url',
    );
  });
  it('sem linha ou sem chave: logoUrl null', async () => {
    const a = montar([]);
    expect(await a.rodar(() => a.ctl.obter())).toEqual({
      logoUrl: null,
      distribuidora: 'CAHU Distribuidora',
    });
    const b = montar([{ logo: null }]);
    expect((await b.rodar(() => b.ctl.obter())).logoUrl).toBeNull();
  });
});

describe('PUT /admin/identidade/logo', () => {
  it('operador recebe 403 e nada é gravado', async () => {
    const { ctl, control, rodar } = montar();
    await expect(
      rodar(async () => ctl.definirLogo(reqOp, { url: URL_OK })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(control).not.toHaveBeenCalled();
  });
  it('admin: upsert que cria a linha e funde a chave em config_json', async () => {
    const { ctl, control, tenantQ, rodar } = montar();
    expect(
      await rodar(() => ctl.definirLogo(reqAdmin, { url: URL_OK })),
    ).toEqual({ logoUrl: URL_OK });
    const [sql, params] = control.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain('insert into tenant_temas');
    expect(sql).toContain('on conflict (tenant_id) do update');
    expect(sql).toContain('tenant_temas.config_json ||');
    expect(params[0]).toBe('tnt-1');
    expect(JSON.parse(params[1] as string)).toEqual({
      logo_retaguarda_url: URL_OK,
    });
    expect(String((tenantQ.mock.calls[0] as unknown[])[0])).toContain(
      'auditoria',
    );
  });
  it('null remove só a chave, sem apagar as outras', async () => {
    const { ctl, control, rodar } = montar();
    expect(await rodar(() => ctl.definirLogo(reqAdmin, { url: null }))).toEqual(
      { logoUrl: null },
    );
    const sql = String((control.mock.calls[0] as unknown[])[0]);
    expect(sql).toContain(`tenant_temas.config_json - 'logo_retaguarda_url'`);
  });
  it('URL que não é do nosso upload é rejeitada', async () => {
    const { ctl, control, rodar } = montar();
    for (const url of [
      'javascript:alert(1)',
      'https://x.com/logo.png',
      'ftp://h/uploads/a.png',
      '/uploads/a.png',
      'https://h/uploads/../a.png',
    ]) {
      await expect(
        rodar(async () => ctl.definirLogo(reqAdmin, { url })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(control).not.toHaveBeenCalled();
  });
  it('DTO: string longa ou tipo errado é rejeitado; null e URL passam', async () => {
    const erros = (url: unknown) => validate(plainToInstance(LogoDto, { url }));
    expect(
      (await erros('https://h/uploads/' + 'a'.repeat(600))).length,
    ).toBeGreaterThan(0);
    expect((await erros(5)).length).toBeGreaterThan(0);
    expect(await erros(null)).toHaveLength(0);
    expect(await erros(URL_OK)).toHaveLength(0);
  });
});

describe('GET /v1/config — logo_retaguarda_url', () => {
  const TENANT_APP = { ...TENANT, appNome: 'CAHU Delivery' };
  async function config(temaRow: Record<string, unknown> | undefined) {
    const db = {
      controlPool: () => ({
        query: jest.fn(async () => ({ rows: temaRow ? [temaRow] : [] })),
      }),
    };
    const svc = new CatalogService(db as never);
    return runComTenant(
      {
        tenant: TENANT_APP as never,
        pool: { query: jest.fn(async () => ({ rows: [] })) } as never,
      },
      () => svc.config(),
    );
  }
  it('expõe o campo sem mexer nos existentes', async () => {
    const linha = {
      cor_primaria: '#FFD500',
      cor_secundaria: '#1A1A1A',
      logo_url: 'https://l/x.png',
      splash_url: null,
      config_json: { logo_retaguarda_url: URL_OK, outra: 1 },
    };
    const r = await config(linha);
    expect(r.tema).toMatchObject({ ...linha, logo_retaguarda_url: URL_OK });
    expect(r.appNome).toBe('CAHU Delivery');
  });
  it('null quando não definida; tema null sem linha', async () => {
    expect(
      (
        await config({
          cor_primaria: '#fff',
          cor_secundaria: '#000',
          logo_url: null,
          splash_url: null,
          config_json: {},
        })
      ).tema?.logo_retaguarda_url,
    ).toBeNull();
    expect((await config(undefined)).tema).toBeNull();
  });
});
