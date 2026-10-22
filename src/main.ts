import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module.js';
import { setupApp } from '@/app.setup.js';
import { getAppType } from '@/config/app-type.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule.register(getAppType()));
  setupApp(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
