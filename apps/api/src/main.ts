import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';

export const PASTA_UPLOADS = join(process.cwd(), 'uploads');

async function bootstrap() {
  if (!existsSync(PASTA_UPLOADS)) mkdirSync(PASTA_UPLOADS, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Imagens enviadas pela retaguarda (banners, fotos de produto).
  // Em produção/escala isso migra para storage S3-compatível sem mudar as URLs salvas.
  app.useStaticAssets(PASTA_UPLOADS, { prefix: '/uploads/' });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
