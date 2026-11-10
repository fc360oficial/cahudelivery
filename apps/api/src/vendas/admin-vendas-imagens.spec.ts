import 'reflect-metadata';
import { runComTenant } from '../tenancy/tenant-context';
import { solucaoExigida } from '../admin/solucoes';
import * as imagem from '../admin/imagem-produto';
import * as upload from '../admin/upload-imagem';
import { AdminVendasImagensController } from './admin-vendas-imagens.controller';
import { AdminUploadController } from '../admin/admin-upload.controller';
import { AdminService } from '../admin/admin.service';

const ID = '11111111-1111-4111-8111-111111111111';
const req = { admin: { usuarioId: 'u1', papel: 'operador', solucoes: ['vendas'] } } as never;

describe('fotos de produto no painel de Vendas', () => {
  afterEach(() => jest.restoreAllMocks());

  it('as rotas ficam sob /v1/admin/vendas, que exige a solução vendas', () => {
    expect(Reflect.getMetadata('path', AdminVendasImagensController)).toBe('admin/vendas');
    const caminhos = Object.getOwnPropertyNames(AdminVendasImagensController.prototype)
      .filter((m) => m !== 'constructor')
      .map((m) => Reflect.getMetadata('path', (AdminVendasImagensController.prototype as never)[m]));
    expect(caminhos.sort()).toEqual(['produtos/:id/imagem', 'produtos/:id/imagem', 'upload']);
    expect(solucaoExigida('/v1/admin/vendas/upload')).toBe('vendas');
    expect(solucaoExigida('/v1/admin/vendas/produtos/x/imagem')).toBe('vendas');
    // O Delivery segue exigindo delivery.
    expect(solucaoExigida('/v1/admin/upload')).toBe('delivery');
    expect(solucaoExigida('/v1/admin/produtos/x/imagem')).toBe('delivery');
  });

  it('PUT delega à lógica compartilhada com o pool do tenant e o usuário logado', async () => {
    const definir = jest.spyOn(imagem, 'definirImagemProduto').mockResolvedValue({ ok: true });
    const pool = { query: jest.fn() };
    const ctl = new AdminVendasImagensController();
    const out = await runComTenant({ tenant: {}, pool } as never, async () =>
      ctl.definir(req, ID, { url: 'https://x/u/a.jpg', urlMiniatura: 'https://x/u/a-m.jpg' }),
    );
    expect(out).toEqual({ ok: true });
    expect(definir).toHaveBeenCalledWith(pool, ID, 'https://x/u/a.jpg', 'u1', 'https://x/u/a-m.jpg');
  });

  it('DELETE delega à lógica compartilhada', async () => {
    const remover = jest.spyOn(imagem, 'removerImagemProduto').mockResolvedValue({ ok: true });
    const pool = { query: jest.fn() };
    const out = await runComTenant({ tenant: {}, pool } as never, async () =>
      new AdminVendasImagensController().remover(req, ID),
    );
    expect(out).toEqual({ ok: true });
    expect(remover).toHaveBeenCalledWith(pool, ID, 'u1');
  });

  it('upload usa o mesmo tratamento do Delivery', async () => {
    const resp = jest.spyOn(upload, 'responderUploadImagem').mockResolvedValue({ url: 'u', urlMiniatura: 'm' } as never);
    const r = { protocol: 'http' } as never;
    const arq = { path: 'p' } as never;
    expect(await new AdminVendasImagensController().upload(r, 'produto', arq)).toEqual({ url: 'u', urlMiniatura: 'm' });
    expect(await new AdminUploadController().upload(r, 'produto', arq)).toEqual({ url: 'u', urlMiniatura: 'm' });
    expect(resp).toHaveBeenCalledTimes(2);
    expect(resp).toHaveBeenNthCalledWith(1, r, 'produto', arq);
  });

  it('Delivery e Vendas usam as mesmas opções de upload (pasta, limite e filtro)', () => {
    const o = upload.opcoesUploadImagem();
    expect(o.limits.fileSize).toBe(5 * 1024 * 1024);
    const cb = jest.fn();
    o.fileFilter(null, { originalname: 'a.pdf', mimetype: 'application/pdf' } as never, cb);
    expect(cb.mock.calls[0][1]).toBe(false);
    o.fileFilter(null, { originalname: 'a.JPG', mimetype: 'image/jpeg' } as never, cb);
    expect(cb.mock.calls[1]).toEqual([null, true]);
  });

  it('as rotas de imagem do Delivery usam o mesmo código (AdminService delega, mesmo pool)', async () => {
    const definir = jest.spyOn(imagem, 'definirImagemProduto').mockResolvedValue({ ok: true });
    const remover = jest.spyOn(imagem, 'removerImagemProduto').mockResolvedValue({ ok: true });
    const pool = { query: jest.fn() };
    const svc = new AdminService(null as never, null as never);
    await runComTenant({ tenant: {}, pool } as never, async () => {
      await svc.definirImagemProduto(ID, 'u', 'u1', 'm');
      await svc.removerImagemProduto(ID, 'u1');
    });
    expect(definir).toHaveBeenCalledWith(pool, ID, 'u', 'u1', 'm');
    expect(remover).toHaveBeenCalledWith(pool, ID, 'u1');
  });
});
