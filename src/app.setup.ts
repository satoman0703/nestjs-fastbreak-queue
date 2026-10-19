import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';

/**
 * main.ts と e2e テストで同じ設定にするため、アプリ全体の設定はここにまとめる
 */
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // @Body({ schema }) などに渡した zod のスキーマで、リクエストを検証する
  app.useGlobalPipes(new StandardSchemaValidationPipe());
}
