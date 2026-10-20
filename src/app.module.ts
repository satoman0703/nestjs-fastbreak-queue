import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { HealthController } from '@/health/health.controller.js';
import { IngestionModule } from '@/ingestion/ingestion.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';

@Module({
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
