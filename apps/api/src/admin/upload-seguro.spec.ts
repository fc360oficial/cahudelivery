import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { AdminIdentidadeController, ApenasAdminGuard } from './admin-identidade.controller';
import { responderUploadImagem } from './upload-imagem';

const req = { protocol: 'http', get: () => 'localhost:3000' } as never;

describe('upload da identidade: papel checado antes de gravar o arquivo', () => {
  const ctx = (papel: string) => ({ switchToHttp: () => ({ getRequest: () => ({ admin: { papel } }) }) }) as never;

  it('operador é barrado pelo guard (403), que roda antes do interceptor de upload', () => {
    expect(() => new ApenasAdminGuard().canActivate(ctx('operador'))).toThrow(ForbiddenException);
    expect(new ApenasAdminGuard().canActivate(ctx('admin'))).toBe(true);
  });

  it('a rota de upload tem o guard registrado no método', () => {
    const guards = Reflect.getMetadata('__guards__', AdminIdentidadeController.prototype.upload) as unknown[];
    expect(guards).toContain(ApenasAdminGuard);
  });
});

describe('responderUploadImagem: conteúdo inválido', () => {
  let pasta: string;
  beforeEach(async () => { pasta = await mkdtemp(join(tmpdir(), 'upl-')); });
  afterEach(async () => { await rm(pasta, { recursive: true, force: true }); });

  const arquivo = (caminho: string, nome: string) => ({ path: caminho, filename: nome }) as Express.Multer.File;

  for (const tipo of [undefined, 'produto', 'categoria']) {
    it(`arquivo que não é imagem (tipo ${tipo ?? 'banner/logo'}) dá 400 e é apagado`, async () => {
      const caminho = join(pasta, 'falso.png');
      await writeFile(caminho, Buffer.from('isto nao e uma imagem'));
      const erro = await responderUploadImagem(req, tipo, arquivo(caminho, 'falso.png')).catch((e) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.getResponse()).toMatchObject({ message: 'Arquivo de imagem inválido' });
      expect(await readdir(pasta)).toEqual([]);
    });
  }

  it('imagem válida segue com a mesma resposta', async () => {
    const caminho = join(pasta, 'ok.png');
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toFile(caminho);
    const out = await responderUploadImagem(req, undefined, arquivo(caminho, 'ok.png'));
    expect(out).toEqual({ url: 'http://localhost:3000/uploads/ok.png' });
    expect(await readdir(pasta)).toEqual(['ok.png']);
  });

  it('foto de produto válida gera as duas versões', async () => {
    const caminho = join(pasta, 'p.png');
    await sharp({ create: { width: 40, height: 20, channels: 3, background: '#c00' } }).png().toFile(caminho);
    const out = (await responderUploadImagem(req, 'produto', arquivo(caminho, 'p.png'))) as { url: string; urlMiniatura: string };
    expect(out.url).toBe('http://localhost:3000/uploads/p.jpg');
    expect(out.urlMiniatura).toBe('http://localhost:3000/uploads/p-m.jpg');
  });
});
