import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { getAppType } from './config/app-type.js';

async function bootstrap() {
  getAppType();
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
