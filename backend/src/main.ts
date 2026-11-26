import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: true,
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT) || 18087;
  // 未设置 HOST 时沿用 app.listen(port)，在所有网卡上监听（开发行为不变）。
  // 生产容器需设置 HOST=0.0.0.0，以便前端 Nginx 和其他容器能够访问。
  const host = process.env.HOST?.trim();
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
  const bindHost = host || '0.0.0.0';
  console.log(`GenSSL backend listening on http://${bindHost}:${port}/api`);
}

void bootstrap();
