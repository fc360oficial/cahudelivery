import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';

export const PASTA_UPLOADS = join(process.cwd(), 'uploads');

async function bootstrap() {
  if (!existsSync(PASTA_UPLOADS)) mkdirSync(PASTA_UPLOADS, { recursive: true });
  // bodyParser: false + useBodyParser: o limite padrão (100 KB) recusava com 413 as cargas
  // em bloco do Dlinks (ex.: 5.000 preços ≈ 350 KB) antes de chegar no controller (18/09/2026).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: '20mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '20mb' });
  app.setGlobalPrefix('v1');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Imagens enviadas pela retaguarda (banners, fotos de produto).
  // Em produção/escala isso migra para storage S3-compatível sem mudar as URLs salvas.
  app.useStaticAssets(PASTA_UPLOADS, { prefix: '/uploads/' });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
