import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_TYPE, type AppType } from '@/config/app-type.js';
import { HealthController } from '@/health/health.controller.js';
import { IngestionModule } from '@/ingestion/ingestion.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';
import { WorkerModule } from '@/worker/worker.module.js';

@Module({})
export class AppModule {
  /**
   * appType を引数で受け取る。@Module() に直接条件を書くと、import した時点で評価され、
   * テストで APP_TYPE を差し替えても間に合わない
   */
  static register(appType: AppType): DynamicModule {
    return {
      module: AppModule,
      imports: [
        // Redis への接続はアプリ全体で 1 つ。各モジュールは registerQueue でキューだけを宣言する
        BullModule.forRoot({
          // BullMQ 6 は ESM だと接続設定から ioredis を作れないため、インスタンスを渡す。
          // maxRetriesPerRequest: null は worker で使うときに BullMQ が必須にしている
          connection: new Redis({
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
            maxRetriesPerRequest: null,
          }),
          prefix: process.env.BULL_PREFIX,
        }),
        PrismaModule,
        IngestionModule,
        ...(appType === 'worker' ? [WorkerModule] : []),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_TYPE, useValue: appType }],
    };
  }
}
