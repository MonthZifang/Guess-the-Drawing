import { NestFactory } from '@nestjs/core';
import { config as loadEnv } from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  // 读取项目根目录 .env（已 gitignore）；已存在的环境变量优先，不覆盖
  const candidates = [
    path.resolve(__dirname, '../../../.env'), // apps/server/{dist,src}/main.ts → 项目根
    path.resolve(process.cwd(), '.env'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      loadEnv({ path: p });
    }
  }

  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`server listening on http://127.0.0.1:${port}`);
}

bootstrap();
